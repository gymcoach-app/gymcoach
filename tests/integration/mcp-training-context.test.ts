import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createGymCoachMcpServer } from '@/lib/mcp/server';
import { db } from '@/lib/db';
import { generateMcpToken, hashMcpToken } from '@/lib/mcp/auth';

const openServers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(openClients.splice(0).map((client) => client.close()));
  await Promise.allSettled(openServers.splice(0).map((server) => server.close()));
});

describe('MCP get_training_context exerciseId exposure', () => {
  it('includes exerciseId for each exercise in session exercises', async () => {
    // Seed user with MCP token
    const user = await db.user.create({
      data: { email: 'mcp-training-context@test.dev', passwordHash: 'x' },
    });
    const token = generateMcpToken();
    await db.mcpAccessToken.create({
      data: {
        userId: user.id,
        name: 'training context test',
        tokenHash: hashMcpToken(token),
        tokenPrefix: token.slice(0, 12),
        canWrite: false,
      },
    });

    // Create exercise and session with sets
    const bench = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });

    const startedAt = new Date('2026-10-30T10:00:00Z');
    const finishedAt = new Date('2026-10-30T11:00:00Z');
    const session = await db.session.create({
      data: { userId: user.id, startedAt, finishedAt },
    });

    await db.set.createMany({
      data: [
        {
          sessionId: session.id,
          exerciseId: bench.id,
          setNumber: 1,
          weight: 100,
          reps: 8,
          rir: 2,
        },
        {
          sessionId: session.id,
          exerciseId: bench.id,
          setNumber: 2,
          weight: 100,
          reps: 8,
          rir: 2,
        },
      ],
    });

    // Connect MCP client
    const server = createGymCoachMcpServer({
      principal: { tokenId: 'test-token', userId: user.id, canWrite: false },
      baseUrl: 'https://test.local',
    });
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    openServers.push(server);
    openClients.push(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    // Call get_training_context
    const result = await client.callTool({ name: 'get_training_context', arguments: {} });

    // Parse the response
    const content = (result.content as Array<{ type: string; text?: string }>)[0];
    expect(content?.type).toBe('text');
    if (content?.type !== 'text' || !content.text) return;

    const payload = JSON.parse(content.text);

    // Verify exerciseId is present in week summary exercises
    const currentWeek = payload.coach.weekCurrent;
    expect(currentWeek.sessions).toBeDefined();
    expect(currentWeek.sessions.length).toBeGreaterThan(0);

    const sessionWithBench = currentWeek.sessions.find((s: any) =>
      s.exercises.some((e: any) => e.exerciseName === 'Bench Press'),
    );
    expect(sessionWithBench).toBeDefined();

    const benchExercise = sessionWithBench.exercises.find(
      (e: any) => e.exerciseName === 'Bench Press',
    );
    expect(benchExercise).toBeDefined();
    expect(benchExercise.exerciseId).toBe(bench.id);
    expect(benchExercise.sets.length).toBe(2);
  });
});

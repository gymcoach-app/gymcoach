import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { MCP_WRITE_RATE_LIMIT } from '@/lib/mcp/limits';
import { createGymCoachMcpServer } from '@/lib/mcp/server';
import { resetRateLimits } from '@/lib/rate-limit';

const openServers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const openClients: Client[] = [];

beforeEach(() => resetRateLimits());

afterEach(async () => {
  await Promise.allSettled(openClients.splice(0).map((client) => client.close()));
  await Promise.allSettled(openServers.splice(0).map((server) => server.close()));
});

async function connect(userId: string, tokenId: string) {
  const server = createGymCoachMcpServer({
    principal: { tokenId, userId, canWrite: true },
    baseUrl: 'https://gymcoach.example',
  });
  const client = new Client({ name: 'write-rate-limit-test', version: '1.0.0' });
  openServers.push(server);
  openClients.push(client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function textOf(result: unknown): string {
  return JSON.stringify((result as { content?: unknown }).content ?? '');
}

const updateWeight = (weightKg: number) => ({
  name: 'update_user_properties',
  arguments: { confirmed: true, currentWeightKg: weightKg },
});

// Well-formed cuid that matches no row: answers "not found" until throttled.
const removeMissingExercise = {
  name: 'remove_program_exercise',
  arguments: { confirmed: true, programExerciseId: 'clx0000000000000000000000' },
};

// Issue #376: a write-enabled token is throttled per token across every write tool.
describe('GymCoach MCP write rate limit', () => {
  it('refuses the write call past the limit with a tool error and writes nothing', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-rate-limit@test.dev', passwordHash: 'x' },
    });
    const client = await connect(user.id, 'token-rate-limit');

    const beforeLimit = await client.callTool(removeMissingExercise);
    expect(textOf(beforeLimit)).toContain('Program exercise not found');

    for (let i = 1; i < MCP_WRITE_RATE_LIMIT; i++) {
      const res = await client.callTool(updateWeight(70 + (i % 10)));
      expect(res.isError).toBeFalsy();
    }

    const refused = await client.callTool(updateWeight(99));
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('Too many write calls');
    expect(await db.bodyweightEntry.count({ where: { userId: user.id } })).toBe(
      MCP_WRITE_RATE_LIMIT - 1,
    );

    // The limit covers every write tool, not only the one that used it up.
    const otherWrite = await client.callTool(removeMissingExercise);
    expect(otherWrite.isError).toBe(true);
    expect(textOf(otherWrite)).toContain('Too many write calls');

    // Reads are not throttled.
    const read = await client.callTool({ name: 'list_gyms', arguments: {} });
    expect(read.isError).toBeFalsy();
  });

  it('keeps a separate budget for another token of the same user', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-rate-limit-two@test.dev', passwordHash: 'x' },
    });
    const first = await connect(user.id, 'token-first');
    for (let i = 0; i < MCP_WRITE_RATE_LIMIT; i++) await first.callTool(updateWeight(80));
    expect((await first.callTool(updateWeight(80))).isError).toBe(true);

    const second = await connect(user.id, 'token-second');
    expect((await second.callTool(updateWeight(81))).isError).toBeFalsy();
  });
});

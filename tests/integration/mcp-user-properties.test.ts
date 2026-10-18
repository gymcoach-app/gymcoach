import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createGymCoachMcpServer } from '@/lib/mcp/server';

const openServers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(openClients.splice(0).map((client) => client.close()));
  await Promise.allSettled(openServers.splice(0).map((server) => server.close()));
});

async function connect(userId: string, canWrite: boolean) {
  const server = createGymCoachMcpServer({
    principal: { tokenId: `token-${userId}`, userId, canWrite },
    baseUrl: 'https://gymcoach.example',
  });
  const client = new Client({ name: 'user-properties-test', version: '1.0.0' });
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

describe('GymCoach MCP user properties', () => {
  it('refuses a current-weight update for a read-only token', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-weight-readonly@test.dev', passwordHash: 'x', bodyweight: 75 },
    });
    const client = await connect(user.id, false);

    const res = await client.callTool({
      name: 'update_user_properties',
      arguments: { confirmed: true, currentWeightKg: 81 },
    });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('read-only');
    expect(await db.bodyweightEntry.count({ where: { userId: user.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).bodyweight).toBe(75);
  });

  it('records a bodyweight entry and syncs the profile value for a write token', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-weight-write@test.dev', passwordHash: 'x', bodyweight: 75 },
    });
    const other = await db.user.create({
      data: { email: 'mcp-weight-other@test.dev', passwordHash: 'x', bodyweight: 90 },
    });
    const client = await connect(user.id, true);

    const res = await client.callTool({
      name: 'update_user_properties',
      arguments: { confirmed: true, currentWeightKg: 81.4 },
    });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ ok: true, currentWeightKg: 81.4 });
    const entries = await db.bodyweightEntry.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.weightKg).toBe(81.4);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).bodyweight).toBe(81.4);

    // The principal scopes every write: another user is never touched.
    expect(await db.bodyweightEntry.count({ where: { userId: other.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).bodyweight).toBe(90);
  });

  it('rejects an update with no supported property and writes nothing', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-weight-empty@test.dev', passwordHash: 'x' },
    });
    const client = await connect(user.id, true);

    const res = await client.callTool({
      name: 'update_user_properties',
      arguments: { confirmed: true },
    });

    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('Provide at least one property');
    expect(await db.bodyweightEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects an out-of-range weight before any write', async () => {
    const user = await db.user.create({
      data: { email: 'mcp-weight-range@test.dev', passwordHash: 'x', bodyweight: 75 },
    });
    const client = await connect(user.id, true);

    const res = await client.callTool({
      name: 'update_user_properties',
      arguments: { confirmed: true, currentWeightKg: 5 },
    });

    expect(res.isError).toBe(true);
    expect(await db.bodyweightEntry.count({ where: { userId: user.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).bodyweight).toBe(75);
  });
});

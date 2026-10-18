import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGymCoachMcpServer,
  GYMCOACH_MCP_INSTRUCTIONS,
  GYMCOACH_MCP_TOOL_NAMES,
} from './server';

interface CapabilityGroup {
  tools?: string[];
  read?: string[];
  write?: string[];
}

interface CapabilityIndexResult {
  writeAccess: boolean;
  writeAccessNote: string;
  capabilities: { allTools: string[] } & Record<string, CapabilityGroup>;
}

const openServers: Array<ReturnType<typeof createGymCoachMcpServer>> = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(openClients.splice(0).map((client) => client.close()));
  await Promise.allSettled(openServers.splice(0).map((server) => server.close()));
});

describe('GymCoach MCP server', () => {
  it('advertises agent instructions, resources, prompts and safe tool annotations', async () => {
    const server = createGymCoachMcpServer({
      principal: { tokenId: 'token-1', userId: 'user-1', canWrite: true },
      baseUrl: 'https://gymcoach.example',
    });
    const client = new Client({ name: 'gymcoach-test', version: '1.0.0' });
    openServers.push(server);
    openClients.push(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
      [...GYMCOACH_MCP_TOOL_NAMES].sort(),
    );
    expect(byName.has('list_gyms')).toBe(true);
    expect(byName.has('get_gym_inventory')).toBe(true);
    expect(byName.has('get_gym_equipment_image')).toBe(true);
    expect(byName.has('update_gym_free_weights')).toBe(true);
    expect(byName.has('upsert_gym_equipment')).toBe(true);
    expect(byName.has('set_gym_equipment_image')).toBe(true);
    expect(byName.has('get_training_context')).toBe(true);
    expect(byName.has('update_user_properties')).toBe(true);
    expect(byName.get('update_user_properties')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(byName.get('update_user_properties')?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['confirmed']),
    });
    expect(
      Object.keys(byName.get('update_user_properties')?.inputSchema.properties ?? {}),
    ).toContain('currentWeightKg');
    expect(byName.has('create_program')).toBe(true);
    expect(byName.has('update_program_exercise')).toBe(true);
    expect(byName.get('list_gyms')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_gym_inventory')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_gym_equipment_image')?.annotations?.readOnlyHint).toBe(true);
    for (const name of [
      'update_gym_free_weights',
      'upsert_gym_equipment',
      'set_gym_equipment_image',
    ]) {
      // These overwrite whole lists, item fields, exercise links or image bytes
      // with no undo, so clients that gate their confirmation UI on the hint
      // must be told to ask.
      expect(byName.get(name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
    expect(byName.get('upsert_gym_equipment')?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['confirmed', 'gymId', 'name', 'equipmentType']),
    });
    expect(byName.get('update_gym_free_weights')?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['confirmed']),
    });
    expect(byName.get('set_gym_equipment_image')?.inputSchema).toMatchObject({
      required: expect.arrayContaining(['confirmed', 'equipmentId']),
    });
    expect(
      Object.keys(byName.get('set_gym_equipment_image')?.inputSchema.properties ?? {}),
    ).not.toContain('imageUrl');
    // An empty upload is refused by the schema, before the handler runs.
    expect(byName.get('set_gym_equipment_image')?.inputSchema.properties).toMatchObject({
      imageBase64: { minLength: 1 },
    });
    expect(byName.has('preview_historical_equipment_backfill')).toBe(true);
    expect(byName.has('apply_historical_equipment_backfill')).toBe(true);
    expect(byName.has('undo_historical_equipment_backfill')).toBe(true);
    expect(byName.get('list_historical_equipment_backfills')?.annotations?.readOnlyHint).toBe(true);
    // add_workout: an agent asked to "add a cardio day" used to have only
    // create_program (a whole new, inactive program) or add_program_exercise.
    expect(byName.has('add_workout')).toBe(true);
    expect(byName.get('add_workout')?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get('add_workout')?.annotations?.destructiveHint).toBe(false);
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/call add_workout on that program/);
    expect(byName.get('get_mcp_capability_index')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('get_training_context')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('preview_historical_equipment_backfill')?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(byName.get('apply_historical_equipment_backfill')?.annotations?.readOnlyHint).toBe(
      false,
    );
    expect(byName.get('undo_historical_equipment_backfill')?.annotations?.destructiveHint).toBe(
      true,
    );
    expect(byName.get('remove_program_exercise')?.annotations?.destructiveHint).toBe(true);

    const capabilityIndex = await client.callTool({ name: 'get_mcp_capability_index' });
    const capabilityContent = capabilityIndex.content as Array<{ type: string; text?: string }>;
    const capabilityText = capabilityContent.find((item) => item.type === 'text');
    const capabilityResult = (
      capabilityText?.text ? JSON.parse(capabilityText.text) : null
    ) as CapabilityIndexResult | null;
    expect(capabilityResult).toMatchObject({
      writeAccess: true,
      capabilities: {
        allTools: GYMCOACH_MCP_TOOL_NAMES,
        discovery: { tools: ['get_mcp_capability_index'] },
        trainingContext: { tools: ['get_training_context'] },
        exerciseCatalog: { tools: ['list_exercises'] },
        profile: {
          write: ['update_user_properties'],
        },
        gyms: {
          read: ['list_gyms', 'get_gym_inventory', 'get_gym_equipment_image'],
          write: ['update_gym_free_weights', 'upsert_gym_equipment', 'set_gym_equipment_image'],
        },
        equipmentHistory: {
          read: ['preview_historical_equipment_backfill', 'list_historical_equipment_backfills'],
          write: ['apply_historical_equipment_backfill', 'undo_historical_equipment_backfill'],
        },
        programs: {
          read: ['list_programs', 'get_program'],
          write: [
            'create_program',
            'update_program_metadata',
            'add_workout',
            'add_program_exercise',
            'update_program_exercise',
            'remove_program_exercise',
            'activate_program',
          ],
        },
      },
    });
    // A write-enabled connection is told the confirmation rule, not the read-only refusal.
    expect(capabilityResult!.writeAccessNote).toMatch(/confirmed: true/);
    expect(capabilityResult!.writeAccessNote).not.toMatch(/read-only/);

    // The index is only useful if it cannot drift: rebuild the tool list from
    // the groups a client actually receives (not from the exported constant)
    // and hold it against what the server registers.
    const { allTools, ...groups } = capabilityResult!.capabilities;
    const grouped = Object.values(groups).flatMap((group) => [
      ...(group.tools ?? []).map((name) => ({ name, write: false })),
      ...(group.read ?? []).map((name) => ({ name, write: false })),
      ...(group.write ?? []).map((name) => ({ name, write: true })),
    ]);
    const groupedNames = grouped.map((entry) => entry.name);
    expect(groupedNames).toHaveLength(23);
    // No tool sits in two groups, and none is listed without a group.
    expect(new Set(groupedNames).size).toBe(groupedNames.length);
    expect([...allTools].sort()).toEqual([...groupedNames].sort());
    expect([...groupedNames].sort()).toEqual(tools.tools.map((tool) => tool.name).sort());
    // A group's read/write label is a promise about the tool's annotation.
    for (const { name, write } of grouped) {
      expect(byName.get(name)?.annotations?.readOnlyHint, `${name} readOnlyHint`).toBe(!write);
    }

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      'gymcoach://instructions/agent',
    );
    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain('build-training-program');

    const instructions = await client.readResource({ uri: 'gymcoach://instructions/agent' });
    expect(instructions.contents[0]).toMatchObject({ text: GYMCOACH_MCP_INSTRUCTIONS });
    // Write tools are no longer program-only: the rule must name every domain.
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(
      /Write tools \(programs, gym inventory, equipment history, profile properties\) change saved data/,
    );
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(
      /Update bodyweight only through update_user_properties/,
    );
    expect(GYMCOACH_MCP_INSTRUCTIONS).not.toMatch(/Program-writing tools/);
    // The confirmation rule covers every destructive write, not only program exercises.
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(
      /Never delete, remove or undo saved data .* without explicit confirmation/,
    );
    expect(GYMCOACH_MCP_INSTRUCTIONS).toMatch(/call get_mcp_capability_index once/);
  });

  it('tells a read-only connection that the write tools in the index are refused', async () => {
    const server = createGymCoachMcpServer({
      principal: { tokenId: 'token-2', userId: 'user-1', canWrite: false },
      baseUrl: 'https://gymcoach.example',
    });
    const client = new Client({ name: 'gymcoach-test', version: '1.0.0' });
    openServers.push(server);
    openClients.push(client);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const capabilityIndex = await client.callTool({ name: 'get_mcp_capability_index' });
    expect(capabilityIndex.isError).toBeFalsy();
    const structured = capabilityIndex.structuredContent as CapabilityIndexResult;
    expect(structured.writeAccess).toBe(false);
    expect(structured.writeAccessNote).toMatch(/read-only/);
    // Same index either way: the flag, not a filtered list, carries the scope.
    expect(structured.capabilities.allTools).toEqual(GYMCOACH_MCP_TOOL_NAMES);
    expect(structured.capabilities.programs?.write).toContain('create_program');
    expect(structured.capabilities.profile?.write).toContain('update_user_properties');
  });
});

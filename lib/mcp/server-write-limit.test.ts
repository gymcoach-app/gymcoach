// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { consumeMcpWriteQuota, MCP_WRITE_RATE_LIMIT } from '@/lib/mcp/limits';
import { resetRateLimits } from '@/lib/rate-limit';
import { createGymCoachMcpServer } from './server';

beforeEach(() => resetRateLimits());

// The SDK keeps registered tools on a private field; the handler is the
// function behind schema validation, so calling it with no arguments shows
// what each tool does before it reads any input.
interface RegisteredTool {
  annotations?: { readOnlyHint?: boolean };
  handler: (args: unknown, extra: unknown) => Promise<unknown>;
}

function registeredTools(server: ReturnType<typeof createGymCoachMcpServer>) {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
}

// Issue #376: every tool that changes saved data spends the per-token write
// budget first, so a write tool added later cannot skip the limit unnoticed.
describe('MCP write limit coverage', () => {
  it('refuses every write tool once the token has spent its write budget', async () => {
    const tokenId = 'token-write-limit-coverage';
    const server = createGymCoachMcpServer({
      principal: { tokenId, userId: 'user-1', canWrite: true },
      baseUrl: 'https://gymcoach.example',
    });
    for (let i = 0; i < MCP_WRITE_RATE_LIMIT; i++) consumeMcpWriteQuota(tokenId);

    const writeTools = Object.entries(registeredTools(server)).filter(
      ([, tool]) => tool.annotations?.readOnlyHint === false,
    );
    expect(writeTools.map(([name]) => name)).toContain('set_gym_equipment_image');
    expect(writeTools.length).toBe(13);

    for (const [name, tool] of writeTools) {
      await expect(tool.handler({}, {}), name).rejects.toThrow(/Too many write calls/);
    }
  });

  it('marks every tool with an explicit readOnlyHint, so none escapes the filter above', () => {
    const server = createGymCoachMcpServer({
      principal: { tokenId: 'token-hints', userId: 'user-1', canWrite: true },
      baseUrl: 'https://gymcoach.example',
    });
    for (const [name, tool] of Object.entries(registeredTools(server))) {
      expect(typeof tool.annotations?.readOnlyHint, name).toBe('boolean');
    }
  });
});

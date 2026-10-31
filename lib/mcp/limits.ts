import { ApiError, readBodyBytesWithCap } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';

// Request body cap for /mcp (issue #376). The largest legitimate call is
// set_gym_equipment_image: its imageBase64 field accepts up to 7,100,000
// characters (a 5 MB image in base64, see MAX_GYM_EQUIPMENT_IMAGE_BYTES), and
// the JSON-RPC envelope adds well under 1 MB, so 8 MiB leaves headroom without
// letting a caller hand the transport an unbounded body.
export const MCP_MAX_BODY_BYTES = 8 * 1024 * 1024;

// Largest number of array elements plus object members one tools/call
// arguments payload may hold, counted by the MCP SDK before schema validation.
// The byte cap alone does not bound this: 8 MiB of `[0,0,0,...]` is millions of
// elements, and validating them could exhaust memory (GHSA advisory fixed in
// @modelcontextprotocol/sdk 1.32). The largest legitimate inputs are a
// generated program (7 workouts of up to 15 exercises, about 1,200 members),
// a historical backfill (500 set ids) and the gym free weights (3 lists of up
// to 200), so 10,000 leaves ample headroom.
export const MCP_MAX_TOOL_INPUT_ELEMENTS = 10_000;

// Write tools per token: 60 calls per minute. Enough for an agent building a
// program or a gym inventory call by call, low enough that a leaked token
// cannot hammer the database (or upload equipment images) without pause.
export const MCP_WRITE_RATE_LIMIT = 60;
export const MCP_WRITE_RATE_WINDOW_MS = 60_000;

export type McpBodyResult =
  | { ok: true; body: Uint8Array<ArrayBuffer> }
  | { ok: false; status: 400 | 413 };

// Reads the body with the shared capped reader (lib/api.ts), which counts the
// bytes received, so a missing or understated Content-Length does not get past
// the cap. A declared length over the cap is refused without reading. A body
// that cannot be read (the client aborted mid-upload) is a 400, not a 500.
export async function readMcpBody(req: Request, maxBytes: number): Promise<McpBodyResult> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) return { ok: false, status: 413 };
  try {
    return { ok: true, body: await readBodyBytesWithCap(req, maxBytes) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 413) return { ok: false, status: 413 };
    return { ok: false, status: 400 };
  }
}

// Consumes one write call from the token's window, or throws the error the
// tool returns to the client. Keyed by token id, not user, as each token is a
// separate credential that can leak on its own.
export function consumeMcpWriteQuota(tokenId: string, now: number = Date.now()): void {
  const { ok, retryAfterSec } = rateLimit(
    `mcp-write:${tokenId}`,
    MCP_WRITE_RATE_LIMIT,
    MCP_WRITE_RATE_WINDOW_MS,
    now,
  );
  if (!ok) {
    throw new Error(`Too many write calls for this GymCoach MCP token. Retry in ${retryAfterSec}s.`);
  }
}

import { Buffer } from 'node:buffer';
import { rateLimit } from '@/lib/rate-limit';

// Request body cap for /mcp (issue #376). The largest legitimate call is
// set_gym_equipment_image: its imageBase64 field accepts up to 7,100,000
// characters (a 5 MB image in base64, see MAX_GYM_EQUIPMENT_IMAGE_BYTES), and
// the JSON-RPC envelope adds well under 1 MB, so 8 MiB leaves headroom without
// letting a caller hand the transport an unbounded body.
export const MCP_MAX_BODY_BYTES = 8 * 1024 * 1024;

// Write tools per token: 60 calls per minute. Enough for an agent building a
// program or a gym inventory call by call, low enough that a leaked token
// cannot hammer the database (or upload equipment images) without pause.
export const MCP_WRITE_RATE_LIMIT = 60;
export const MCP_WRITE_RATE_WINDOW_MS = 60_000;

// Reads the body while counting bytes, so a missing or understated
// Content-Length does not get past the cap. Returns null once the body is over
// maxBytes (the rest of the stream is cancelled, not read).
export async function readBodyWithLimit(
  req: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) return null;
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
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
    throw new Error(
      `Too many write calls for this GymCoach MCP token. Retry in ${retryAfterSec} s.`,
    );
  }
}

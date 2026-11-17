// Container healthcheck (issue #576): exits 0 when GET /api/health answers 200
// on the loopback interface, 1 otherwise. Run with the image's own node, so
// the image needs no curl or wget. Used by the Dockerfile HEALTHCHECK and the
// compose files (copied to /app/healthcheck.cjs in the image).
//
// The 4 s limit stays under the 5 s healthcheck timeout, so a hung server is
// reported by this script and not by Docker killing it.

const port = process.env.PORT || '3000';

fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) }).then(
  (res) => process.exit(res.status === 200 ? 0 : 1),
  () => process.exit(1),
);

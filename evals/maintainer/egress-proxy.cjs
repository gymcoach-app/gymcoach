'use strict';
// Egress proxy for the contained eval agent (issue #453). Runs in its own
// container, attached to the agent's --internal network (where it is the only
// other member) and to a normal bridge network (its own way out). The agent
// reaches the internet only through it, with HTTPS_PROXY set.
//
// It serves HTTP CONNECT only, to an allowlist of host:443 pairs given in
// EGRESS_ALLOW (comma-separated host names). Everything else is refused: plain
// HTTP requests, other ports, other hosts, and any allowlisted name that
// resolves to a private, loopback or link-local address (so a DNS answer cannot
// turn an allowed name into a path to the host or the Docker API). Each decision
// is logged as one line (host, port, allowed or refused), never the payload.
//
// Dependency-free so it runs with the stock node image.

/* eslint-disable @typescript-eslint/no-require-imports */
const net = require('net');
const dns = require('dns');

const PORT = Number(process.env.EGRESS_PORT || 3128);
const ALLOW = new Set(
  String(process.env.EGRESS_ALLOW || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

function privateAddress(raw) {
  // An IPv4-mapped IPv6 answer (::ffff:a.b.c.d) is judged as the IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  const ip = mapped ? mapped[1] : raw;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      // IETF protocol assignments, benchmarking, multicast and reserved.
      (a === 192 && b === 0 && Number(ip.split('.')[2]) === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  return (
    v === '::1' ||
    v === '::' ||
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('fe80') ||
    v.startsWith('::ffff:') ||
    !net.isIPv6(v)
  );
}

function log(decision, host, port, why) {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), decision, host, port, why })}\n`,
  );
}

const HEADER_LIMIT = 8192;
const HEADER_TIMEOUT_MS = 10000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

const server = net.createServer((client) => {
  client.on('error', () => {});
  // Read the whole request head before deciding: a client may send it in
  // several chunks, and any bytes after it (the start of the TLS handshake)
  // must be replayed upstream, not dropped.
  let buffered = Buffer.alloc(0);
  const refuse = (status, host, port, why) => {
    log('refused', host, port, why);
    client.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  };
  const headerTimer = setTimeout(() => {
    log('refused', null, null, 'request head timeout');
    client.destroy();
  }, HEADER_TIMEOUT_MS);
  const onData = (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    const end = buffered.indexOf('\r\n\r\n');
    if (end === -1) {
      if (buffered.length > HEADER_LIMIT) {
        clearTimeout(headerTimer);
        client.removeListener('data', onData);
        refuse('431 Request Header Fields Too Large', null, null, 'request head too large');
      }
      return;
    }
    clearTimeout(headerTimer);
    client.removeListener('data', onData);
    // Hold the rest of the stream while the name is resolved and dialled.
    client.pause();
    const head = buffered.subarray(0, end).toString('latin1');
    const rest = buffered.subarray(end + 4);
    const line = head.split('\r\n')[0] || '';
    const match = /^CONNECT ([A-Za-z0-9.-]+):(\d+) HTTP\/1\.[01]$/.exec(line);
    if (!match) return refuse('405 Method Not Allowed', null, null, 'not a CONNECT request');
    const host = match[1].toLowerCase();
    const port = Number(match[2]);
    if (port !== 443 || !ALLOW.has(host))
      return refuse('403 Forbidden', host, port, 'not allowlisted');
    dns.lookup(host, { family: 4 }, (err, address) => {
      if (err || !address || privateAddress(address))
        return refuse(
          '403 Forbidden',
          host,
          port,
          err ? 'dns error' : 'resolves to a private address',
        );
      // Connect to the address that was checked, not to the name again: a
      // second resolution could answer differently (DNS rebinding).
      const upstream = net.connect(port, address, () => {
        log('allowed', host, port, null);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) upstream.write(rest);
        upstream.pipe(client);
        client.pipe(upstream);
        client.resume();
      });
      for (const s of [client, upstream])
        s.setTimeout(IDLE_TIMEOUT_MS, () => {
          client.destroy();
          upstream.destroy();
        });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
    });
  };
  client.on('data', onData);
});

server.listen(PORT, '0.0.0.0', () => log('listening', null, PORT, [...ALLOW].join(',')));

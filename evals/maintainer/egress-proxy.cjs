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
      (a === 100 && b >= 64 && b <= 127)
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

const server = net.createServer((client) => {
  client.once('data', (head) => {
    const text = head.toString('latin1');
    const line = text.split('\r\n')[0] || '';
    const match = /^CONNECT ([A-Za-z0-9.-]+):(\d+) HTTP\/1\.[01]$/.exec(line);
    if (!match) {
      log('refused', null, null, 'not a CONNECT request');
      client.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n');
      return;
    }
    const host = match[1].toLowerCase();
    const port = Number(match[2]);
    if (port !== 443 || !ALLOW.has(host)) {
      log('refused', host, port, 'not allowlisted');
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    dns.lookup(host, { family: 4 }, (err, address) => {
      if (err || !address || privateAddress(address)) {
        log('refused', host, port, err ? 'dns error' : 'resolves to a private address');
        client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      const upstream = net.connect(port, address, () => {
        log('allowed', host, port, null);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
  });
  client.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => log('listening', null, PORT, [...ALLOW].join(',')));

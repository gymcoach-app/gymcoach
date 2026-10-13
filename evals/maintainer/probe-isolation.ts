import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  agentContainerSpec,
  gradeContainer,
  prepareAgentHome,
  runCleanups,
  runContainer,
  startEgress,
  tempDir,
} from './run';
import { EGRESS_ALLOWLIST, EGRESS_PROXY_PORT } from './runner';

// Proves the eval containment without a model call:
//
//   npx tsx evals/maintainer/probe-isolation.ts
//
// 1. The agent container: built exactly as the `claude` agent's (prepareAgentHome,
//    startEgress, agentContainerSpec), on its --internal network behind the
//    egress proxy, but running a shell probe instead of claude.
// 2. A unit-tier grading container (gradeContainer, no network).
//
// Each check prints ok when the container CANNOT do the thing, except the
// reach-model-api check, which is ok when the allowlisted API answers a TLS
// handshake through the proxy (no request is sent, nothing is spent). Exit 0
// only when every check is ok.

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname })
  .toString()
  .trim();
const hostHome = homedir();

// Absolute host paths the containers must not reach, tested from inside.
const hostPaths = {
  ghHosts: path.join(hostHome, '.config/gh/hosts.yml'),
  gitCredentials: path.join(hostHome, '.git-credentials'),
  ssh: path.join(hostHome, '.ssh'),
  gitconfig: path.join(hostHome, '.gitconfig'),
  liveCheckout: path.join(repoRoot, 'package.json'),
};

// Network helper run inside the containers: `direct <host> <port>` opens a TCP
// connection; `proxy <proxyHost> <host> <port>` asks the proxy for a CONNECT
// tunnel and completes a TLS handshake through it. Exit 0 when reached.
const NET_HELPER = [
  "const net = require('net');",
  "const tls = require('tls');",
  'const [mode, a, b, c] = process.argv.slice(2);',
  'const done = (ok) => process.exit(ok ? 0 : 1);',
  'setTimeout(() => done(false), 6000);',
  "if (mode === 'direct') {",
  '  const s = net.connect(Number(b), a);',
  "  s.on('connect', () => done(true));",
  "  s.on('error', () => done(false));",
  '} else {',
  `  const s = net.connect(${EGRESS_PROXY_PORT}, a);`,
  "  s.on('error', () => done(false));",
  "  s.on('connect', () => {",
  '    s.write(`CONNECT ${b}:${c} HTTP/1.1\\r\\nHost: ${b}:${c}\\r\\n\\r\\n`);',
  "    s.once('data', (d) => {",
  "      if (!/ 200 /.test(d.toString().split('\\r\\n')[0])) return done(false);",
  '      const t = tls.connect({ socket: s, servername: b }, () => done(true));',
  "      t.on('error', () => done(false));",
  '    });',
  '  });',
  '}',
  '',
].join('\n');

const COMMON = `
check() { if eval "$2" >/dev/null 2>&1; then echo "FAIL $1"; else echo "ok $1"; fi; }
expect() { if eval "$2" >/dev/null 2>&1; then echo "ok $1"; else echo "FAIL $1"; fi; }
check read-gh-token "cat '${hostPaths.ghHosts}'"
check read-git-credentials "cat '${hostPaths.gitCredentials}'"
check read-ssh-keys "ls '${hostPaths.ssh}'"
check read-host-gitconfig "cat '${hostPaths.gitconfig}'"
check read-live-checkout "cat '${hostPaths.liveCheckout}'"
check token-in-env "env | grep -E '^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|ANTHROPIC_API_KEY|DATABASE_URL)='"
check write-node-modules "touch /work/node_modules/.probe-write"
check write-root-fs "touch /etc/probe-write"
check sudo "sudo -n true"
check reach-docker-api "node /work/.probe-net.cjs direct host.docker.internal 2375"
check reach-host-postgres "node /work/.probe-net.cjs direct host.docker.internal 5434"
check reach-public-internet "node /work/.probe-net.cjs direct github.com 443"
check reach-public-ip "node /work/.probe-net.cjs direct 1.1.1.1 443"
`;

function agentProbe(proxy: string): string {
  return `${COMMON}
check write-claude-binary "touch /usr/local/bin/claude"
check write-credential "touch \\"$HOME/.claude/.credentials.json\\""
check home-gh-config "test -e \\"$HOME/.config/gh\\""
check git-remote-exists "test -n \\"$(git -C /work remote)\\""
check git-push "git -C /work push origin HEAD"
check gh-cli "gh api user"
check proxy-docker-api "node /work/.probe-net.cjs proxy ${proxy} host.docker.internal 2375"
check proxy-github "node /work/.probe-net.cjs proxy ${proxy} github.com 443"
check proxy-plain-http "node /work/.probe-net.cjs proxy ${proxy} example.com 80"
expect reach-model-api "node /work/.probe-net.cjs proxy ${proxy} ${EGRESS_ALLOWLIST[0]} 443"
expect claude-starts-with-read-only-credential "claude --version"
echo "info home-entries $(cd "$HOME" && find . -mindepth 1 | sort | tr '\\n' ' ')"
`;
}

function workspace(): string {
  // A minimal workspace shaped like a snapshot: one commit, no remote, an empty
  // node_modules mount point.
  const work = tempDir('gymcoach-eval-ws-');
  writeFileSync(path.join(work, 'README.md'), 'probe\n');
  writeFileSync(path.join(work, '.probe-net.cjs'), NET_HELPER);
  mkdirSync(path.join(work, 'node_modules'));
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
    ['-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-q', '-m', 'snapshot'],
  ])
    execFileSync('git', args, { cwd: work });
  return work;
}

function report(label: string, stdout: string, status: number | null): string[] {
  const lines = stdout.split('\n').filter((l) => /^(ok|FAIL|info) /.test(l));
  for (const l of lines) console.log(`${label} ${l}`);
  if (status !== 0) return [`${label} probe exited ${status}`];
  return lines.filter((l) => l.startsWith('FAIL '));
}

function main(): number {
  const failed: string[] = [];
  let checks = 0;

  const egress = startEgress();
  const home = prepareAgentHome();
  const agentWork = workspace();
  const agent = runContainer(
    agentContainerSpec(repoRoot, agentWork, home, egress, ['bash', '-c', agentProbe(egress.proxy)]),
    180_000,
  );
  failed.push(...report('agent', agent.stdout || agent.stderr || '', agent.status));
  checks += (agent.stdout || '').split('\n').filter((l) => /^(ok|FAIL) /.test(l)).length;

  const gradeWork = workspace();
  const reports = tempDir('gymcoach-eval-reports-');
  const grade = runContainer(
    gradeContainer(repoRoot, gradeWork, reports, 'none', null, COMMON, []),
    180_000,
  );
  failed.push(...report('grade', grade.stdout || grade.stderr || '', grade.status));
  checks += (grade.stdout || '').split('\n').filter((l) => /^(ok|FAIL) /.test(l)).length;

  console.log(JSON.stringify({ checks, failed: failed.length }));
  return checks > 0 && failed.length === 0 ? 0 : 1;
}

const code = (() => {
  try {
    return main();
  } finally {
    runCleanups();
  }
})();
process.exit(code);

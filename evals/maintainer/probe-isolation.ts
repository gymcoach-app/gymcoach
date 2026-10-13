import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { agentContainerSpec, prepareAgentHome, withContainerMountPoint } from './run';
import { containerArgs } from './runner';

// Proves the paid agent's container isolation without a model call:
//
//   npx tsx evals/maintainer/probe-isolation.ts
//
// It builds the exact container the `claude` agent gets (agentContainerSpec,
// containerArgs, prepareAgentHome), but runs a shell probe instead of claude.
// Each check prints ok when the agent CANNOT do the thing. Exit 0 only when every
// check is ok. Spends nothing.
//
// The network checks fail today (issue #453): the container can reach the
// unauthenticated Docker Desktop engine API and host services, and has open
// egress. The paid agent stays disabled (runner.ts PAID_AGENT_DISABLED_REASON)
// until this probe exits 0.

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname })
  .toString()
  .trim();
const hostHome = homedir();

// Absolute host paths the agent must not reach, tested from inside.
const hostPaths = {
  ghHosts: path.join(hostHome, '.config/gh/hosts.yml'),
  gitCredentials: path.join(hostHome, '.git-credentials'),
  ssh: path.join(hostHome, '.ssh'),
  gitconfig: path.join(hostHome, '.gitconfig'),
  liveCheckout: path.join(repoRoot, 'package.json'),
};

const probe = `
check() { if eval "$2" >/dev/null 2>&1; then echo "FAIL $1"; else echo "ok $1"; fi; }
check read-gh-token "cat '${hostPaths.ghHosts}'"
check read-git-credentials "cat '${hostPaths.gitCredentials}'"
check read-ssh-keys "ls '${hostPaths.ssh}'"
check read-host-gitconfig "cat '${hostPaths.gitconfig}'"
check read-live-checkout "cat '${hostPaths.liveCheckout}'"
check home-gh-config "test -e \\"$HOME/.config/gh\\""
check git-remote-exists "test -n \\"$(git -C /work remote)\\""
check git-push "git -C /work push origin HEAD"
check gh-cli "gh api user"
check token-in-env "env | grep -E '^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|ANTHROPIC_API_KEY|DATABASE_URL)='"
check write-node-modules "touch /work/node_modules/.probe-write"
check write-claude-binary "touch /usr/local/bin/claude"
check write-root-fs "touch /etc/probe-write"
check sudo "sudo -n true"
check reach-docker-api "node /work/.probe-net.cjs http://host.docker.internal:2375/version"
check reach-host-postgres "node /work/.probe-net.cjs tcp:host.docker.internal:5434"
check reach-public-internet "node /work/.probe-net.cjs https://github.com/"
echo "info home-entries $(cd "$HOME" && find . -mindepth 1 | sort | tr '\\n' ' ')"
echo "info uid $(id -u) workspace-writable $(touch /work/.probe-write && echo yes || echo no)"
`;

function main(): number {
  const work = mkdtempSync(path.join(tmpdir(), 'gymcoach-eval-ws-'));
  const home = prepareAgentHome();
  try {
    // A minimal workspace shaped like a materialised snapshot: one commit, no
    // remote, node_modules linked to the host install.
    writeFileSync(path.join(work, 'README.md'), 'probe\n');
    // Network reachability helper: exit 0 when the target answers within 5 s.
    writeFileSync(
      path.join(work, '.probe-net.cjs'),
      [
        'const t = process.argv[2];',
        'const done = (ok) => process.exit(ok ? 0 : 1);',
        'setTimeout(() => done(false), 5000);',
        "if (t.startsWith('tcp:')) {",
        "  const [, host, port] = t.split(':');",
        "  const s = require('net').connect(Number(port), host);",
        "  s.on('connect', () => done(true));",
        "  s.on('error', () => done(false));",
        '} else {',
        '  fetch(t).then(() => done(true), () => done(false));',
        '}',
        '',
      ].join('\n'),
    );
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['add', '-A'],
      ['-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-q', '-m', 'snapshot'],
    ])
      execFileSync('git', args, { cwd: work });
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(work, 'node_modules'));

    const spec = agentContainerSpec(repoRoot, work, home, ['bash', '-c', probe]);
    const run = withContainerMountPoint(work, () =>
      spawnSync('docker', containerArgs(spec), { encoding: 'utf8', timeout: 120_000 }),
    );
    process.stdout.write(run.stdout);
    if (run.status !== 0 || run.error) {
      process.stderr.write(run.stderr || String(run.error));
      return 3;
    }
    const lines = run.stdout
      .split('\n')
      .filter((l) => l.startsWith('ok ') || l.startsWith('FAIL '));
    const failed = lines.filter((l) => l.startsWith('FAIL '));
    console.log(JSON.stringify({ image: spec.image, checks: lines.length, failed: failed.length }));
    return lines.length > 0 && failed.length === 0 ? 0 : 1;
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

process.exit(main());

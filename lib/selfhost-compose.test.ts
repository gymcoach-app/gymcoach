import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// docker-compose.selfhost.yml lists the app's environment one variable at a
// time (no env_file), so a provider setting the code reads but the file does
// not pass never reaches the container (review of #505: OPENROUTER_MAX_TOKENS
// and the codex-lb variables were silently ignored).
const root = path.join(__dirname, '..');
const llmDir = path.join(root, 'lib', 'llm');

function providerEnvVars(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(llmDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(path.join(llmDir, file), 'utf8');
    for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]!);
  }
  return [...names].sort();
}

function appEnvironment(compose: string): Set<string> {
  const app = compose.slice(compose.indexOf('\n  app:'));
  const block = app.slice(app.indexOf('    environment:'));
  const names = new Set<string>();
  for (const line of block.split('\n').slice(1)) {
    if (/^ {4}\S/.test(line)) break;
    const match = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
    if (match) names.add(match[1]!);
  }
  return names;
}

describe('docker-compose.selfhost.yml', () => {
  it('passes every LLM provider variable the code reads to the app', () => {
    const compose = readFileSync(path.join(root, 'docker-compose.selfhost.yml'), 'utf8');
    const passed = appEnvironment(compose);
    const vars = providerEnvVars();
    expect(vars).toContain('OPENROUTER_MAX_TOKENS');
    expect(passed.has('JWT_SECRET')).toBe(true);
    expect(vars.filter((name) => !passed.has(name))).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isGroupA,
  lensCoverage,
  normaliseLens,
  requiredLenses,
  translatedLocale,
  trustTier,
} from './lenses';

const rules = (files: string[], tier: 'maintainer' | 'vetted' | 'unvetted' = 'maintainer') =>
  requiredLenses({ files, tier }).map((r) => (r.advisory ? `${r.rule}?` : r.rule));

describe('review lens routing', () => {
  it('base rule: every PR needs correctness or tests', () => {
    expect(rules(['lib/stats.ts'])).toEqual(['base']);
    const [base] = requiredLenses({ files: [], tier: 'maintainer' });
    expect(base!.anyOf).toEqual(['correctness', 'tests']);
  });

  it('group A rule: security and threat-model, for any tier', () => {
    expect(rules(['lib/mcp/tools.ts'])).toEqual([
      'base',
      'group-a-security',
      'group-a-threat-model',
    ]);
    for (const path of [
      'lib/auth.ts',
      'lib/auth/session.ts',
      'lib/api.ts',
      'lib/rate-limit.ts',
      'app/api/mcp-tokens/route.ts',
      'app/api/backup/route.ts',
      'app/api/history/csv/route.ts',
      'lib/llm/index.ts',
      'lib/prompts/coach.ts',
      'prisma/schema.prisma',
      'prisma/migrations/1_init/migration.sql',
      'messages/en/common.ts',
      'i18n/config.ts',
    ]) {
      expect(isGroupA(path), path).toBe(true);
    }
    for (const path of [
      'lib/apiary.ts',
      'lib/coach.ts',
      'prisma/seed.ts',
      'app/api/locale/route.ts',
    ]) {
      expect(isGroupA(path), path).toBe(false);
    }
  });

  it('external rule: a non-maintainer author always needs security', () => {
    expect(rules(['lib/stats.ts'], 'vetted')).toEqual(['base', 'external-security']);
    expect(rules(['lib/stats.ts'], 'unvetted')).toEqual(['base', 'external-security']);
  });

  it('docs rule: a docs-only PR needs docs-accuracy as well', () => {
    expect(rules(['docs/faq.md', 'README.md', 'changelog.d/1-x.md'])).toEqual([
      'base',
      'docs-accuracy',
    ]);
    // One code file makes it a code PR.
    expect(rules(['docs/faq.md', 'lib/stats.ts'])).toEqual(['base']);
    // A non-markdown file under docs/ is still docs.
    expect(rules(['docs/media/shot.png'])).toEqual(['base', 'docs-accuracy']);
  });

  it('translation rule: required for an external author, advisory for a maintainer', () => {
    expect(translatedLocale('messages/es/common.ts')).toBe('es');
    expect(translatedLocale('messages/en/common.ts')).toBeNull();
    expect(translatedLocale('i18n/exercise-names.ts')).toBeNull();
    expect(rules(['messages/es/common.ts'], 'unvetted')).toEqual([
      'base',
      'group-a-security',
      'group-a-threat-model',
      'external-security',
      'translation-quality',
    ]);
    expect(rules(['messages/es/common.ts'])).toContain('translation-quality?');
    expect(rules(['messages/en/common.ts'], 'unvetted')).not.toContain('translation-quality');
  });

  it('normalises lens names to the spellings past records used', () => {
    expect(normaliseLens(' Security ')).toBe('security');
    expect(normaliseLens('backdoor-egress')).toBe('security');
    expect(normaliseLens('egress-backdoor')).toBe('security');
    expect(normaliseLens('docs')).toBe('docs-accuracy');
    expect(normaliseLens('regression')).toBe('regression');
  });

  it('reports uncovered groups, enforced and advisory apart', () => {
    const reqs = requiredLenses({ files: ['messages/es/common.ts'], tier: 'maintainer' });
    const { missing, advisoryMissing } = lensCoverage(reqs, ['Tests', 'security']);
    expect(missing.map((r) => r.rule)).toEqual(['group-a-threat-model']);
    expect(advisoryMissing.map((r) => r.rule)).toEqual(['translation-quality']);
    // An unknown lens name satisfies nothing.
    expect(lensCoverage(reqs.slice(0, 1), ['i18n']).missing).toHaveLength(1);
  });

  it('fails closed on the trust tier', () => {
    const maintainers = [{ id: 16043912 }];
    expect(trustTier({ login: 'JulienAu', id: 16043912 }, maintainers)).toBe('maintainer');
    // A maintainer login on another account id is not a maintainer.
    expect(trustTier({ login: 'JulienAu', id: 1 }, maintainers)).toBe('unvetted');
    expect(trustTier(null, maintainers)).toBe('unvetted');
    expect(trustTier({ login: 'Retsumdk', id: 2 }, maintainers, ['Retsumdk'])).toBe('vetted');
  });
});

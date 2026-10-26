// Review lens routing (roadmap milestone 4): which review lenses a PR needs,
// as a pure function of the paths it changes and its author's trust tier. The
// merge gate (automation/publish/gate.ts) refuses a merge when the ready review
// records do not cover every required group; the CLI prints the groups for a
// live PR so the orchestrator dispatches the right reviewers up front.
//
//   npx tsx automation/review/lenses.ts <pr>
//
// The rules encode the practice of docs/loops/10-external-contributions.md
// (trust tiers, hard-block group A, the security lenses (a) and (d)). They only
// add requirements: no rule removes another, so a PR that hits several rules
// needs all of them. A requirement is a group of lens names, any one of which
// satisfies it.

export type TrustTier = 'maintainer' | 'vetted' | 'unvetted';

export interface LensRequirement {
  rule: string;
  // Any one of these lenses (normalised) satisfies the requirement.
  anyOf: string[];
  reason: string;
  // Advisory requirements are reported, never enforced.
  advisory: boolean;
}

export interface LensRoutingInput {
  // Every path the PR changes, including the old path of a rename.
  files: readonly string[];
  tier: TrustTier;
}

// Hard-block group A (docs/loops/10-external-contributions.md, "Group A -
// security-sensitive code"). Prefix entries end with `/` or are the start of
// a glob such as `lib/auth*`; exact entries name one file.
const GROUP_A_PREFIXES = [
  'lib/auth',
  'lib/mcp/',
  'lib/rate-limit',
  'app/api/mcp-tokens/',
  'app/api/backup/',
  'app/api/history/csv/',
  'lib/llm/',
  'lib/prompts/',
  'prisma/migrations/',
  'messages/',
  'i18n/',
] as const;
const GROUP_A_FILES = ['lib/api.ts', 'prisma/schema.prisma'] as const;

export function isGroupA(path: string): boolean {
  return (
    (GROUP_A_FILES as readonly string[]).includes(path) ||
    GROUP_A_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export function isDocsPath(path: string): boolean {
  return path.startsWith('docs/') || path.toLowerCase().endsWith('.md');
}

// A translated catalog module: messages/<locale>/..., any locale but en.
export function translatedLocale(path: string): string | null {
  const match = /^messages\/([^/]+)\//.exec(path);
  return match && match[1] !== 'en' ? match[1]! : null;
}

// Spellings that past records used for the same lens. Lowercase and trimmed
// before the lookup; anything not listed stays as written, so an unknown name
// never satisfies a requirement by accident.
const LENS_ALIASES: Record<string, string> = {
  'egress-backdoor': 'security',
  'backdoor-egress': 'security',
  egress: 'security',
  docs: 'docs-accuracy',
  test: 'tests',
};

export function normaliseLens(lens: string): string {
  const key = lens.trim().toLowerCase();
  return LENS_ALIASES[key] ?? key;
}

export function requiredLenses({ files, tier }: LensRoutingInput): LensRequirement[] {
  const external = tier !== 'maintainer';
  const out: LensRequirement[] = [
    {
      rule: 'base',
      anyOf: ['correctness', 'tests'],
      reason: 'every PR needs a correctness or tests review',
      advisory: false,
    },
  ];
  const groupA = files.filter(isGroupA);
  if (groupA.length > 0) {
    // docs/loops/10 sets the group A conditions for external PRs; the loop's
    // own work on these paths is governed by the charter, so for a maintainer
    // both lenses are advisory.
    const reason = `touches group A paths (${summarise(groupA)})${external ? '' : '; advisory for a maintainer'}`;
    out.push(
      { rule: 'group-a-security', anyOf: ['security'], reason, advisory: !external },
      { rule: 'group-a-threat-model', anyOf: ['threat-model'], reason, advisory: !external },
    );
  }
  if (external) {
    out.push({
      rule: 'external-security',
      anyOf: ['security'],
      reason: `the author is not a maintainer (tier ${tier})`,
      advisory: false,
    });
  }
  if (files.length > 0 && files.every(isDocsPath)) {
    out.push({
      rule: 'docs-accuracy',
      anyOf: ['docs-accuracy'],
      reason: 'a docs-only PR is reviewed against the code it describes',
      advisory: false,
    });
  }
  const locales = [...new Set(files.map(translatedLocale).filter((l): l is string => l !== null))];
  if (locales.length > 0) {
    out.push({
      rule: 'translation-quality',
      anyOf: ['translation-quality'],
      reason: `changes translated catalogs (${locales.sort().join(', ')})${external ? '' : '; advisory for a maintainer'}`,
      advisory: !external,
    });
  }
  return out;
}

export interface LensCoverage {
  missing: LensRequirement[];
  advisoryMissing: LensRequirement[];
}

// Which requirements the given lenses (the union over the ready records) leave
// uncovered.
export function lensCoverage(
  requirements: readonly LensRequirement[],
  lenses: readonly string[],
): LensCoverage {
  const have = new Set(lenses.map(normaliseLens));
  const uncovered = requirements.filter((r) => !r.anyOf.some((lens) => have.has(lens)));
  return {
    missing: uncovered.filter((r) => !r.advisory),
    advisoryMissing: uncovered.filter((r) => r.advisory),
  };
}

// The trust tier for the gate. Maintainers match on the numeric user id (as
// the review-comment trust does); a missing author is unvetted. Vetted logins
// are compared on the login: the policy file lists logins, and vetted grants
// no more than unvetted in these rules.
export function trustTier(
  author: { login: string; id: number } | null,
  maintainers: readonly { id: number }[],
  vetted: readonly string[] = [],
): TrustTier {
  if (!author) return 'unvetted';
  if (maintainers.some((m) => m.id === author.id)) return 'maintainer';
  return vetted.includes(author.login) ? 'vetted' : 'unvetted';
}

function summarise(paths: string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown;
}

async function main() {
  try {
    await cli();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`lenses.ts: ${message.split('\n')[0]}`);
    process.exit(3);
  }
}

async function cli() {
  const prArg = process.argv[2];
  if (!prArg || !/^[1-9][0-9]*$/.test(prArg)) {
    console.error('Usage: lenses.ts <pr>');
    process.exit(2);
  }
  // Loaded here, not at the top: merge.ts imports the gate, which imports
  // this module.
  const { MAINTAINERS } = await import('@/automation/publish/checks');
  const { fetchPull, fetchChangedFiles, readVettedLogins } =
    await import('@/automation/publish/merge');
  const pr = Number(prArg);
  const live = fetchPull(pr);
  const files = fetchChangedFiles(pr, live.changedFileCount);
  if (files === null) {
    console.error(`Could not read every changed file of PR #${pr}; the gate would refuse.`);
    process.exit(1);
  }
  const tier = trustTier(live.author, MAINTAINERS, readVettedLogins());
  console.log(
    `PR #${pr} by ${live.author?.login ?? 'unknown'} (tier ${tier}), ${files.length} file(s)`,
  );
  for (const r of requiredLenses({ files, tier })) {
    const kind = r.advisory ? 'advisory' : 'required';
    console.log(`- ${kind} ${r.rule}: one of [${r.anyOf.join(', ')}] - ${r.reason}`);
  }
}

if (process.argv[1]?.endsWith('lenses.ts')) void main();

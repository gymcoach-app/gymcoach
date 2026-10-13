import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBundleSchema } from '@/automation/records/schema';
import { type ReportMeta, renderReport } from '@/automation/baseline/report';
import { formatReport } from '@/automation/baseline/format';
import { usageMetaSchema, usageRecordSchema } from '@/automation/usage/schema';

// Re-renders report.md from a collected runs.jsonl and meta.json (plus
// usage.jsonl and usage-meta.json when present), without calling GitHub or
// reading transcripts again:  npx tsx automation/baseline/render.ts <dir>
async function main(dir: string | undefined) {
  if (!dir) throw new Error('Usage: render.ts <dir>');
  const bundles = readFileSync(join(dir, 'runs.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => runBundleSchema.parse(JSON.parse(line)));
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as ReportMeta;
  const usagePath = join(dir, 'usage.jsonl');
  const usage = existsSync(usagePath)
    ? {
        records: readFileSync(usagePath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => usageRecordSchema.parse(JSON.parse(line))),
        meta: usageMetaSchema.parse(JSON.parse(readFileSync(join(dir, 'usage-meta.json'), 'utf8'))),
      }
    : undefined;
  const target = join(dir, 'report.md');
  writeFileSync(target, await formatReport(renderReport(bundles, meta, usage), target));
  console.log(`Rendered ${bundles.length} runs`);
}

void main(process.argv[2]);

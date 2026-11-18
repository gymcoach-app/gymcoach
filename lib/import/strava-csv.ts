import { IMPORT_CSV_MAX_ROWS, readCsvRecords } from '@/lib/import/csv';

// ============================================================
// Strava archive: activities.csv (issue #582) - pure, browser side
// ============================================================
// The index of a Strava bulk export. One row per activity; the Filename cell
// points at the activity file inside the archive (activities/<id>.fit.gz,
// .gpx, .tcx.gz, ...) and is EMPTY for an activity typed in by hand.
//
// The header is not stable. It changed with the export date (2019 exports
// have ten lowercase columns, recent ones about ninety, some names twice),
// and Strava writes it in the account's language. So the columns are found in
// two steps:
//
// 1. By name, against a list of known spellings. Cells are compared without
//    case, accents, spaces or punctuation ("Activity ID", "activity_id" and
//    "ID de l'activite" all reduce to a key of letters and digits). The
//    non-English spellings are best effort: they were not all checked against
//    a real export, and the import does not depend on them.
// 2. By content and position, for whatever step 1 left unresolved. The
//    filename column is the one whose cells look like activities/<file>; the
//    id column is the first one when it holds digits; and when the id is the
//    first column, date, name and type are the next three, which is the
//    order of every export seen so far.
//
// The file is untrusted text all the same: row cap, bounded cells, no eval.

export type StravaCsvField = 'id' | 'date' | 'name' | 'type' | 'filename';

export type StravaCsvColumns = Record<StravaCsvField, number>;

export interface StravaCsvActivity {
  id: string;
  date: string;
  name: string;
  type: string;
  // Path inside the archive (activities/<file>), or null for a manual entry.
  filename: string | null;
}

export interface StravaCsv {
  // False when neither the id nor the filename column could be found: the
  // activity files are still imported, only the manual entry count is unknown.
  recognized: boolean;
  activities: StravaCsvActivity[];
  // Activities with no file in the archive (typed in by hand on Strava).
  // Null when the filename column could not be found: the count is then
  // unknown, which is not the same as zero.
  withoutFile: number | null;
}

// Decompressed size cap for activities.csv. Recent exports carry about ninety
// columns a row, so this is far above the 5 MB of the other CSV imports.
export const STRAVA_CSV_MAX_BYTES = 30 * 1024 * 1024;

const CELL_MAX = 200;

const ALIASES: Record<StravaCsvField, readonly string[]> = {
  id: [
    'activityid',
    'id',
    'iddelactivite',
    'aktivitatsid',
    'iddeactividad',
    'iddelaactividad',
    'idattivita',
    'iddaatividade',
    'activiteitid',
    'activiteitsid',
  ],
  date: [
    'activitydate',
    'date',
    'datedelactivite',
    'aktivitatsdatum',
    'fechadeactividad',
    'fechadelaactividad',
    'dataattivita',
    'datadaatividade',
    'activiteitsdatum',
  ],
  name: [
    'activityname',
    'name',
    'nomdelactivite',
    'namederaktivitat',
    'aktivitatsname',
    'nombredeactividad',
    'nombredelaactividad',
    'nomeattivita',
    'nomedaatividade',
    'activiteitsnaam',
  ],
  type: [
    'activitytype',
    'type',
    'typedactivite',
    'aktivitatsart',
    'aktivitatstyp',
    'tipodeactividad',
    'tipodiattivita',
    'tipodeatividade',
    'activiteitstype',
  ],
  filename: [
    'filename',
    'nomdufichier',
    'dateiname',
    'nombredearchivo',
    'nombredelarchivo',
    'nomefile',
    'nomedoarquivo',
    'nomedoficheiro',
    'bestandsnaam',
  ],
};

// Reduce a header cell to lowercase ASCII letters and digits: no BOM, case,
// accents, spaces or punctuation.
export function stravaHeaderKey(cell: string): string {
  return cell
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const ACTIVITY_PATH = /^\/?(?:[^/]+\/)?activities\/[^/]+\.[a-z0-9]+$/i;
const DIGITS = /^\d{1,20}$/;

// How many data rows the content fallback looks at.
const SNIFF_ROWS = 200;

// Find the five columns (-1 when one cannot be found). `rows` are data rows,
// used only by the content fallback.
export function matchStravaCsvHeader(
  header: readonly string[],
  rows: ReadonlyArray<readonly string[]> = [],
): StravaCsvColumns {
  const keys = header.map(stravaHeaderKey);
  const columns: StravaCsvColumns = { id: -1, date: -1, name: -1, type: -1, filename: -1 };
  // First match wins: recent exports repeat some names further right.
  for (const field of Object.keys(ALIASES) as StravaCsvField[]) {
    columns[field] = keys.findIndex((k) => ALIASES[field].includes(k));
  }

  const sample = rows.slice(0, SNIFF_ROWS);
  if (columns.filename === -1) {
    for (const row of sample) {
      const at = row.findIndex((cell) => ACTIVITY_PATH.test(cell.trim()));
      if (at !== -1) {
        columns.filename = at;
        break;
      }
    }
  }
  if (columns.id === -1 && sample.length > 0 && sample.every((r) => DIGITS.test((r[0] ?? '').trim()))) {
    columns.id = 0;
  }
  if (columns.id === 0 && header.length >= 4) {
    const taken = new Set(Object.values(columns));
    const positional: Array<[StravaCsvField, number]> = [
      ['date', 1],
      ['name', 2],
      ['type', 3],
    ];
    for (const [field, index] of positional) {
      if (columns[field] === -1 && !taken.has(index)) columns[field] = index;
    }
  }
  return columns;
}

// The key an archive entry and a Filename cell are compared by:
// "activities/<file>" in lowercase, whatever folder the archive was re-zipped
// into. Null when the path is not inside an activities folder.
export function stravaActivityKey(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter((p) => p.length > 0 && p !== '.');
  if (parts.length < 2 || parts[parts.length - 2]!.toLowerCase() !== 'activities') return null;
  return `activities/${parts[parts.length - 1]!.toLowerCase()}`;
}

function cell(row: readonly string[], index: number): string {
  if (index < 0) return '';
  return (row[index] ?? '').trim().slice(0, CELL_MAX);
}

export function parseStravaActivitiesCsv(text: string): StravaCsv {
  const records = readCsvRecords(text.length > 0 && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const header = records[0]?.fields ?? [];
  const rows = records.slice(1, 1 + IMPORT_CSV_MAX_ROWS).map((r) => r.fields);
  const columns = matchStravaCsvHeader(header, rows);
  const recognized = columns.id !== -1 || columns.filename !== -1;
  if (!recognized) return { recognized, activities: [], withoutFile: null };

  const activities: StravaCsvActivity[] = [];
  let withoutFile = 0;
  for (const row of rows) {
    const raw = cell(row, columns.filename);
    const filename = raw === '' ? null : (stravaActivityKey(raw) ?? raw);
    if (filename === null) withoutFile += 1;
    activities.push({
      id: cell(row, columns.id),
      date: cell(row, columns.date),
      name: cell(row, columns.name),
      type: cell(row, columns.type),
      filename,
    });
  }
  // Without a filename column nothing can be said about manual entries.
  return { recognized, activities, withoutFile: columns.filename === -1 ? null : withoutFile };
}

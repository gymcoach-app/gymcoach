// ============================================================
// Leading reasoning blocks in model text
// ============================================================
// Some reasoning models served through OpenRouter or an OpenAI-compatible
// server put their thinking in the answer itself, as a leading
// <think>...</think> block (also seen: <thinking>, <reasoning>). That text is
// not part of the answer: it breaks the JSON extraction of structured outputs
// (a brace or a code fence in the thinking is taken for the answer) and it
// would be shown to the user in the coach chat.
//
// Everything here is pure and has no dependency, so the client bundle can
// import it too. Only LEADING blocks are removed: a tag that appears once the
// answer has started (inside a JSON string, in the middle of a sentence) is
// answer text and is kept.

const OPEN_TAG_RE = /^<(think|thinking|reasoning)\s*>/i;
const TAG_NAMES = ['think', 'thinking', 'reasoning'] as const;
type TagName = (typeof TAG_NAMES)[number];

const CLOSE_TAG_RE: Record<TagName, RegExp> = {
  think: /<\/think\s*>/i,
  thinking: /<\/thinking\s*>/i,
  reasoning: /<\/reasoning\s*>/i,
};

// The longest text that can still grow into an opening tag is "<reasoning"
// followed by a little whitespace; anything longer is answer text.
const MAX_PARTIAL_TAG_LENGTH = 32;

type ScanState =
  // The answer has started: `rest` is the answer.
  | 'answer'
  // A leading block is open and not closed (yet): `rest` starts at its tag.
  | 'open'
  // Nothing but whitespace, or the beginning of what may become an opening
  // tag ("<thi"): more text is needed to tell. Only a stream stops here.
  | 'undecided';

interface Scan {
  state: ScanState;
  // The text left after the closed leading blocks. Untouched (leading
  // whitespace included) when no block was removed.
  rest: string;
  stripped: boolean;
}

function mayBecomeOpenTag(text: string): boolean {
  if (text.length > MAX_PARTIAL_TAG_LENGTH) return false;
  const lower = text.toLowerCase();
  if (TAG_NAMES.some((name) => `<${name}`.startsWith(lower))) return true;
  return /^<(think|thinking|reasoning)\s+$/.test(lower);
}

function scan(text: string): Scan {
  let rest = text;
  let stripped = false;
  while (true) {
    const body = rest.trimStart();
    const open = OPEN_TAG_RE.exec(body);
    if (!open) {
      const state = body === '' || mayBecomeOpenTag(body) ? 'undecided' : 'answer';
      return { state, rest: stripped ? body : rest, stripped };
    }
    const afterOpen = body.slice(open[0].length);
    const name = (open[1] ?? 'think').toLowerCase() as TagName;
    const close = CLOSE_TAG_RE[name].exec(afterOpen);
    if (!close) {
      return { state: 'open', rest: stripped ? body : rest, stripped };
    }
    rest = afterOpen.slice(close.index + close[0].length);
    stripped = true;
  }
}

// Removes the leading reasoning blocks (one or several, with any whitespace
// around them) from a complete model answer. A text without a leading block is
// returned unchanged. An unclosed leading block means the model never got to
// its answer (cut off while thinking): the result is then the empty string, so
// the caller's existing "no answer" path applies.
export function stripLeadingReasoning(text: string): string {
  const result = scan(text);
  if (result.state === 'open') return '';
  return result.rest;
}

// Same rule for a stream of text deltas. Nothing is passed on while the start
// of the answer may still be a reasoning block (a tag can be split across
// deltas), so a leading block is held back until it is closed and never
// reaches the reader. Once the answer has started, deltas pass through
// untouched. A stream that ends inside an unclosed block yields nothing.
export async function* stripLeadingReasoningStream(
  source: AsyncIterable<string>,
): AsyncIterable<string> {
  let held = '';
  let started = false;
  // Once a block has been removed, the whitespace that follows it goes too,
  // even when it arrives in a later delta.
  let stripped = false;
  for await (const delta of source) {
    if (started) {
      yield delta;
      continue;
    }
    const result = scan(held + delta);
    stripped = stripped || result.stripped;
    held = stripped ? result.rest.trimStart() : result.rest;
    if (result.state === 'answer') {
      started = true;
      const first = held;
      held = '';
      if (first) yield first;
    }
  }
  // The stream ended before the answer was known to have started: whatever is
  // held is the answer (whitespace, or a lone "<th"), unless a block is open.
  if (!started && held && scan(held).state !== 'open') yield held;
}

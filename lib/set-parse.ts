import { getLlmProvider, LlmError } from '@/lib/llm';
import { SET_PARSE_SYSTEM_PROMPT } from '@/lib/prompts/set-parse-prompt';
import {
  parseSetDescription,
  type SetParseResult,
} from '@/lib/schemas/set-parse';

// Server-side AI parse of one free-text set description (issue #210). Builds the
// compact user message (exercise name + kind + the user's weight unit + the raw
// text), calls the active LLM provider, and validates the UNTRUSTED output
// against the set-parse schema. Returns the typed parse or null on any failure
// (no JSON, junk, refusal, out-of-range, wrong kind, or a provider error) so the
// caller fills nothing - it never throws and never logs garbage.
// aiParseSetWithFailure also hands back the provider error, when that is why
// nothing was parsed, so the route can tell the user the provider is the
// problem and not their text (issue #571).
export interface SetParseContext {
  exerciseName: string;
  kind: 'strength' | 'cardio';
  // The user's display unit, passed to the model so it interprets the weight
  // correctly (it must NOT convert between units).
  unit: 'KG' | 'LB';
}

export interface SetParseAttempt {
  parsed: SetParseResult | null;
  // Set only when the provider call itself failed.
  providerError: LlmError | null;
}

export async function aiParseSet(
  text: string,
  ctx: SetParseContext,
): Promise<SetParseResult | null> {
  return (await aiParseSetWithFailure(text, ctx)).parsed;
}

export async function aiParseSetWithFailure(
  text: string,
  ctx: SetParseContext,
): Promise<SetParseAttempt> {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) return { parsed: null, providerError: null };

  const userMessage = [
    `Exercise: ${ctx.exerciseName}`,
    `Type: ${ctx.kind === 'cardio' ? 'CARDIO' : 'STRENGTH'}`,
    `Weight unit: ${ctx.unit === 'LB' ? 'lb' : 'kg'}`,
    `Set description: ${trimmed}`,
  ].join('\n');

  let responseText: string;
  try {
    const { text: out } = await getLlmProvider().complete({
      system: SET_PARSE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      // A single set is tiny; cap output so a runaway response cannot balloon.
      maxTokens: 200,
      temperature: 0,
    });
    responseText = out;
  } catch (err) {
    // A provider/network error degrades to "could not parse" - never a crash.
    return { parsed: null, providerError: err instanceof LlmError ? err : null };
  }

  const outcome = parseSetDescription(responseText, ctx.kind);
  return { parsed: outcome.ok ? outcome.value : null, providerError: null };
}

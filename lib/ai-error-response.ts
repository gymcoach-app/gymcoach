import { NextResponse } from 'next/server';
import {
  describeLlmFailure,
  getLlmProvider,
  logLlmFailure,
  type LlmError,
  type LlmFailureDescription,
} from '@/lib/llm';

// Classifies a failed provider call for the active provider and logs its
// class and upstream status (nothing else). `scope` names the feature in the
// log line.
export function describeAiFailure(scope: string, err: unknown): LlmFailureDescription {
  const provider = getLlmProvider();
  const failure = describeLlmFailure(err, provider);
  logLlmFailure(scope, provider, failure);
  return failure;
}

// JSON answer of an AI route whose provider call failed:
// { error, code, variable? } with a 502/503/504 status. `error` is the English
// class message, never the provider's own text.
export function aiErrorResponse(scope: string, err: LlmError): NextResponse {
  const failure = describeAiFailure(scope, err);
  return NextResponse.json(failure.body, {
    status: failure.httpStatus,
    headers: { 'Cache-Control': 'no-store' },
  });
}

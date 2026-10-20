import { describe, it, expect } from 'vitest';
import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt';

// Issue #111: the in-session context guidance is INPUT-side only. The chat
// stays free-form text; it must never grow a structured output contract.

describe('chat system prompt', () => {
  it('tells the coach how to use the live currentSession section', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/currentSession/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/mid-workout/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/immediately actionable/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/staying within the user's program/i);
  });

  // Issue #475: a repeated lift is one currentSession entry per block (#488);
  // the prompt names the block field so two entries sharing a name read as
  // two blocks, not as a duplicate.
  it('explains the block field of a repeated lift in currentSession', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/appears once per block in currentSession\.exercises/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/block is null when the lift appears once/);
  });

  // The chat has no write path: a trainee asked the coach to add a cardio
  // session and the model answered as if it had done it. The prompt must say
  // the coach cannot change saved data and must never claim it did.
  it('states the coach is advisory only and must never claim to have changed data', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/advisory only/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/cannot create, change, activate or delete programs/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never say or imply that you added/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Programs page/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/MCP connector/);
    // The Settings toggle is "Allow changes to saved data": the prompt names
    // the capability (write access), not a label that no longer exists.
    expect(CHAT_SYSTEM_PROMPT).toMatch(/MCP connector in Settings with write access enabled/);
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/program changes allowed/i);
    // ...but a mid-workout deviation stays plain advice: the pointer to the
    // Programs page is scoped to LASTING changes, so the in-session guidance
    // above ("reorder or skip an exercise") is not contradicted.
    expect(CHAT_SYSTEM_PROMPT).toMatch(/one-off deviation for today's session/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/lasting change to their saved program/i);
  });

  it('defines no structured output contract (free-form text only)', () => {
    expect(CHAT_SYSTEM_PROMPT).not.toContain('<adjustments>');
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/JSON object/i);
  });
});

import { describe, it, expect } from 'vitest';
import { stripLeadingReasoning, stripLeadingReasoningStream } from './reasoning';

async function* deltas(parts: string[]): AsyncIterable<string> {
  for (const part of parts) yield part;
}

async function collect(parts: string[]): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of stripLeadingReasoningStream(deltas(parts))) out.push(delta);
  return out;
}

describe('stripLeadingReasoning', () => {
  it('returns a text without a reasoning block unchanged', () => {
    expect(stripLeadingReasoning('{"a":1}')).toBe('{"a":1}');
    expect(stripLeadingReasoning('  Hello there.\n')).toBe('  Hello there.\n');
    expect(stripLeadingReasoning('')).toBe('');
    expect(stripLeadingReasoning('   ')).toBe('   ');
  });

  it('removes one leading block and the whitespace around it', () => {
    expect(stripLeadingReasoning('<think>plan {x}</think>{"a":1}')).toBe('{"a":1}');
    expect(stripLeadingReasoning('\n  <think>\nplan\n</think>\n\n{"a":1}\n')).toBe('{"a":1}\n');
  });

  it('removes several leading blocks, of different kinds', () => {
    expect(
      stripLeadingReasoning(
        '<think>one</think>\n<thinking>two</thinking> <reasoning>three</reasoning>\nAnswer',
      ),
    ).toBe('Answer');
  });

  it('matches the tags whatever their case, and tolerates a space before ">"', () => {
    expect(stripLeadingReasoning('<THINK>x</THINK>ok')).toBe('ok');
    expect(stripLeadingReasoning('<Thinking>x</thinking>ok')).toBe('ok');
    expect(stripLeadingReasoning('<Reasoning >x</REASONING >ok')).toBe('ok');
  });

  it('closes a block only with its own tag', () => {
    expect(stripLeadingReasoning('<think>a </thinking> b</think>ok')).toBe('ok');
    expect(stripLeadingReasoning('<thinking>a </think> b</thinking>ok')).toBe('ok');
  });

  it('returns an empty string for an unclosed leading block (no answer)', () => {
    expect(stripLeadingReasoning('<think>still thinking {"a":1}')).toBe('');
    expect(stripLeadingReasoning('<think>one</think><think>two {"a":1}')).toBe('');
    expect(stripLeadingReasoning('<think>')).toBe('');
  });

  it('returns an empty string when nothing follows the block', () => {
    expect(stripLeadingReasoning('<think>only thinking</think>\n')).toBe('');
  });

  it('keeps a block inside a JSON string value', () => {
    const json = '{"note":"<think>keep me</think>","n":1}';
    expect(stripLeadingReasoning(json)).toBe(json);
    expect(stripLeadingReasoning(`<think>x</think>${json}`)).toBe(json);
  });

  it('keeps a block that comes after the answer has started', () => {
    const text = 'Answer first. <think>not leading</think> and more';
    expect(stripLeadingReasoning(text)).toBe(text);
    const unclosed = '{"a":1}\n<think>trailing';
    expect(stripLeadingReasoning(unclosed)).toBe(unclosed);
  });

  it('leaves other tags and look-alikes alone', () => {
    for (const text of [
      '<adjustments>[]</adjustments>',
      '<thinker>x</thinker>ok',
      '<think',
      '< think>x</think>ok',
      '<think attr="1">x</think>ok',
    ]) {
      expect(stripLeadingReasoning(text)).toBe(text);
    }
  });
});

describe('stripLeadingReasoningStream', () => {
  it('passes a stream without a reasoning block through, delta by delta', async () => {
    expect(await collect(['Hel', 'lo ', 'there'])).toEqual(['Hel', 'lo ', 'there']);
    expect(await collect(['  Hi', '!'])).toEqual(['  Hi', '!']);
  });

  it('holds a leading block back until it closes, then streams the answer', async () => {
    expect(await collect(['<think>', 'plan', '</think>', '\n\n', 'Hello', ' there'])).toEqual([
      'Hello',
      ' there',
    ]);
  });

  it('handles tags split across deltas', async () => {
    expect(await collect(['<', 'thi', 'nk>pl', 'an</th', 'ink>He', 'llo'])).toEqual(['He', 'llo']);
    expect(await collect(['<THINK', 'ING>x</Think', 'ing>', 'ok'])).toEqual(['ok']);
  });

  it('strips several leading blocks', async () => {
    expect(await collect(['<think>a</think> <reasoning>', 'b</reasoning>', 'ok'])).toEqual(['ok']);
  });

  it('handles a block and the start of the answer in a single delta', async () => {
    expect(await collect(['<think>a</think>Hello', ' there'])).toEqual(['Hello', ' there']);
  });

  it('yields nothing when the stream ends inside an unclosed block', async () => {
    expect(await collect(['<think>', 'never ', 'closed'])).toEqual([]);
    expect(await collect(['<think>a</think>', '<think>b'])).toEqual([]);
  });

  it('yields nothing when only a block was streamed', async () => {
    expect(await collect(['<think>a', '</think>', '\n'])).toEqual([]);
    expect(await collect([])).toEqual([]);
  });

  it('releases text that only looked like the start of a tag', async () => {
    expect(await collect(['<', 'b>bold</b>'])).toEqual(['<b>bold</b>']);
    expect(await collect(['<thin', 'g>'])).toEqual(['<thing>']);
    expect(await collect(['<thi'])).toEqual(['<thi']);
    expect(await collect([' ', '\n'])).toEqual([' \n']);
  });

  it('keeps a block that comes after the answer has started', async () => {
    expect(await collect(['Answer ', '<think>', 'kept', '</think>'])).toEqual([
      'Answer ',
      '<think>',
      'kept',
      '</think>',
    ]);
  });

  it('gives the same text as the non-streaming helper', async () => {
    const samples = [
      '<think>a {b}</think>\n{"a":1}',
      'plain answer',
      '<think>open',
      '  <reasoning>x</reasoning>  <think>y</think>  done <think>z</think>',
      '<thinker>no</thinker>',
    ];
    for (const sample of samples) {
      const oneByOne = (await collect(sample.split(''))).join('');
      expect(oneByOne).toBe(stripLeadingReasoning(sample));
    }
  });

  it('propagates an error of the source', async () => {
    async function* failing(): AsyncIterable<string> {
      yield '<think>a</think>Hi';
      throw new Error('boom');
    }
    const out: string[] = [];
    await expect(
      (async () => {
        for await (const delta of stripLeadingReasoningStream(failing())) out.push(delta);
      })(),
    ).rejects.toThrow('boom');
    expect(out).toEqual(['Hi']);
  });
});

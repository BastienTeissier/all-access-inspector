import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, test } from 'vitest';

import { type Event, parseLog, readLog, serialize } from '../src/log.ts';

const SAMPLES = join(import.meta.dirname, 'samples');
const SCHEMA = join(import.meta.dirname, '..', '..', 'schema', 'review-event.schema.json');

const lines = (name: string) => readFileSync(join(SAMPLES, name), 'utf8').split('\n').filter(Boolean);
const valid = lines('django-demo.reviews.jsonl');
const invalid = lines('invalid.jsonl');

/** The same object with its keys in reverse order, at every level: serialize must not depend on input order. */
const shuffled = (x: unknown): unknown =>
  Array.isArray(x) ? x : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).reverse().map(([k, v]) => [k, shuffled(v)])) : x;

test('every event type serialises to its sample line', () => {
  expect(new Set(valid.map(l => (JSON.parse(l) as Event).event))).toEqual(new Set(['reviewed', 'signal_raised', 'triaged']));
  for (const line of valid) expect(serialize(shuffled(JSON.parse(line)) as Event)).toBe(`${line}\n`);
});

test('the optional fields are left out, never null', () => {
  const safe = JSON.parse(valid[1]!) as Record<string, unknown>;
  expect(Object.keys(safe)).toEqual(['v', 'at', 'by', 'event', 'batch', 'endpoint', 'seen', 'verdict', 'reason']);
});

describe('readLog errors', () => {
  test('a merge marker names its line', () => {
    const { events, errors } = parseLog(`${valid[0]}\n${valid[1]}\n<<<<<<< HEAD\n`);
    expect(events).toHaveLength(2);
    expect(errors).toEqual([{ line: 3, message: 'not valid JSON' }]);
  });

  test('a newer version, a finding without severity', () => {
    const event = JSON.parse(valid[7]!) as Record<string, unknown>;
    expect(parseLog(JSON.stringify({ ...event, v: 2 })).errors[0]!.message).toContain('newer toolkit');
    const { severity: _, ...noSeverity } = event;
    expect(parseLog(JSON.stringify(noSeverity)).errors[0]!.message).toContain('needs a severity');
  });

  test('a missing file is an empty log', () => {
    expect(readLog(mkdtempSync(join(tmpdir(), 'review-')))).toEqual({ events: [], errors: [] });
  });
});

describe('the schema and the CLI agree', () => {
  const validate = new Ajv2020({ allErrors: true }).compile(JSON.parse(readFileSync(SCHEMA, 'utf8')));

  test.each(valid.map((line, i) => [i + 1, line]))('valid line %i', (_, line) => {
    expect(validate(JSON.parse(line)), JSON.stringify(validate.errors)).toBe(true);
    expect(parseLog(line).errors).toEqual([]);
  });

  test.each(invalid.map((line, i) => [i + 1, line]))('invalid line %i', (_, line) => {
    expect(validate(JSON.parse(line))).toBe(false);
    expect(parseLog(line).errors).toHaveLength(1);
  });
});

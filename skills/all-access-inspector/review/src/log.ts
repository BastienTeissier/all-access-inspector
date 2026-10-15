// The Review Log: tools/access-inspector/reviews.jsonl, one event per line, append-only.

import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { type Key, SEEN_FIELDS, type Seen, seenAxis, toolsDir } from './inventory.ts';

export const VERSION = 1;
export const VERDICTS = ['safe', 'accepted', 'finding'] as const;
export const SEVERITIES = ['low', 'medium', 'high'] as const;

interface Common {
  v: number;
  at: string;
  by: string;
  batch: string | null;
  endpoint: Key;
  seen: Seen;
}

export interface Reviewed extends Common {
  event: 'reviewed';
  verdict: (typeof VERDICTS)[number];
  reason: string;
  severity?: (typeof SEVERITIES)[number];
  ticket?: string;
  until?: string;
}

export interface SignalRaised extends Common {
  event: 'signal_raised';
  reason: string;
  evidence: string;
}

export interface Triaged extends Common {
  event: 'triaged';
}

export type Event = Reviewed | SignalRaised | Triaged;

/** An event with the line it was read from, so equal dates resolve by line order. */
export type Logged = Event & { line: number };

export interface LogError {
  line: number;
  message: string;
}

export const logPath = (project: string): string => join(toolsDir(project), 'reviews.jsonl');

const ATTRIBUTES = 'reviews.jsonl merge=union\n';

const isString = (x: unknown): x is string => typeof x === 'string';
const isText = (x: unknown, max: number): boolean => isString(x) && x.trim() !== '' && x.length <= max;
const isNullableString = (x: unknown): boolean => x === null || isString(x);
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const COMMON_KEYS = ['v', 'at', 'by', 'event', 'batch', 'endpoint', 'seen'];
const EVENT_KEYS = {
  reviewed: ['verdict', 'reason', 'severity', 'ticket', 'until'],
  signal_raised: ['reason', 'evidence'],
  triaged: [],
} as const;

const axisProblem = (axis: unknown, name: string): string | null => {
  if (!isObject(axis) || Object.keys(axis).some(k => !(SEEN_FIELDS as readonly string[]).includes(k))) return `seen.${name} must hold only ${SEEN_FIELDS.join(', ')}`;
  if (!isString(axis.value) || !SEEN_FIELDS.slice(1).every(k => isNullableString(axis[k]))) return `seen.${name} has a wrong type`;
  return null;
};

/** What is wrong with a parsed line, or null; mirrors schema/review-event.schema.json. */
export const problem = (e: unknown): string | null => {
  if (!isObject(e)) return 'not a JSON object';
  if (e.v !== VERSION) return typeof e.v === 'number' && e.v > VERSION ? `written by a newer toolkit (v ${e.v})` : `unknown v ${JSON.stringify(e.v)}`;
  if (!isString(e.event) || !(e.event in EVENT_KEYS)) return `unknown event ${JSON.stringify(e.event)}`;
  const allowed = [...COMMON_KEYS, ...EVENT_KEYS[e.event as Event['event']]];
  const extra = Object.keys(e).find(k => !allowed.includes(k));
  if (extra) return `unexpected field ${extra}`;
  if (!isString(e.at) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(e.at)) return 'at must be YYYY-MM-DDTHH:MM:SSZ';
  if (!isText(e.by, 320)) return 'by is required';
  if (!(e.batch === null || (isString(e.batch) && /^b-[0-9a-f]{8}$/.test(e.batch)))) return 'batch must be null or b-<8 hex>';
  if (!Array.isArray(e.endpoint) || e.endpoint.length !== 3 || !e.endpoint.every(isString)) return 'endpoint must be [method, path, handler]';
  const seen = e.seen;
  if (!isObject(seen) || Object.keys(seen).some(k => !['handler', 'authentication', 'authorization', 'inside'].includes(k))) return 'seen must hold handler, authentication, authorization, inside';
  if (!isString(seen.handler)) return 'seen.handler is required';
  const axis = axisProblem(seen.authentication, 'authentication') ?? axisProblem(seen.authorization, 'authorization');
  if (axis) return axis;
  if (!(seen.inside === null || typeof seen.inside === 'boolean')) return 'seen.inside must be true, false or null';
  if (e.event === 'reviewed') {
    if (!VERDICTS.includes(e.verdict as Reviewed['verdict'])) return `verdict must be one of ${VERDICTS.join(', ')}`;
    if (!isText(e.reason, 2000)) return 'reason is required (at most 2000 characters)';
    if (e.verdict === 'finding' && !SEVERITIES.includes(e.severity as NonNullable<Reviewed['severity']>)) return `a finding needs a severity: ${SEVERITIES.join(', ')}`;
    if (e.verdict !== 'finding' && 'severity' in e) return 'severity is only for a finding';
    if ('ticket' in e && (e.verdict !== 'finding' || !isString(e.ticket) || !/^https?:\/\/\S+$/.test(e.ticket))) return 'ticket must be an http(s) URL, on a finding';
    if ('until' in e && (e.verdict !== 'accepted' || !isString(e.until) || !/^\d{4}-\d\d-\d\d$/.test(e.until))) return 'until must be YYYY-MM-DD, on an accepted verdict';
  }
  if (e.event === 'signal_raised') {
    if (!isText(e.reason, 500)) return 'reason is required (at most 500 characters)';
    if (!isString(e.evidence) || !/^[^\s:]+:\d+$/.test(e.evidence)) return 'evidence must be path:line';
  }
  return null;
};

/** One compact line, keys in the order of the schema, absent optional fields left out. */
export const serialize = (e: Event): string => {
  const out: Record<string, unknown> = {
    v: e.v,
    at: e.at,
    by: e.by,
    event: e.event,
    batch: e.batch,
    endpoint: e.endpoint,
    seen: { handler: e.seen.handler, authentication: seenAxis(e.seen.authentication), authorization: seenAxis(e.seen.authorization), inside: e.seen.inside },
  };
  for (const k of EVENT_KEYS[e.event]) {
    const value = (e as unknown as Record<string, unknown>)[k];
    if (value !== undefined) out[k] = value;
  }
  return `${JSON.stringify(out)}\n`;
};

export const parseLog = (text: string): { events: Logged[]; errors: LogError[] } => {
  const events: Logged[] = [];
  const errors: LogError[] = [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  lines.forEach((text, i) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      errors.push({ line: i + 1, message: 'not valid JSON' });
      return;
    }
    const wrong = problem(parsed);
    if (wrong) errors.push({ line: i + 1, message: wrong });
    else events.push({ ...(parsed as Event), line: i + 1 });
  });
  return { events, errors };
};

/** The project's Review Log; a missing file is an empty log. */
export const readLog = (project: string): { events: Logged[]; errors: LogError[] } => {
  const path = logPath(project);
  return existsSync(path) ? parseLog(readFileSync(path, 'utf8')) : { events: [], errors: [] };
};

/** Appends whole events in one write, after checking every one; adds the union-merge attribute when it is missing. */
export const append = (project: string, events: Event[]): void => {
  for (const e of events) {
    const wrong = problem(e);
    if (wrong) throw new Error(`refused: ${wrong}`);
  }
  const attributes = join(toolsDir(project), '.gitattributes');
  const present = existsSync(attributes) ? readFileSync(attributes, 'utf8') : '';
  if (!present.split('\n').some(line => line.trim().split(/\s+/).join(' ') === ATTRIBUTES.trim()))
    appendFileSync(attributes, `${present && !present.endsWith('\n') ? '\n' : ''}${ATTRIBUTES}`);
  const fd = openSync(logPath(project), 'a');
  try {
    writeSync(fd, events.map(serialize).join(''));
  } finally {
    closeSync(fd);
  }
};

export const newBatch = (): string => `b-${randomBytes(4).toString('hex')}`;

export const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

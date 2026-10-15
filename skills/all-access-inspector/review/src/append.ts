// append: a human Verdict, or the Agent's Signals and Triage, written to the Review Log after every check passes.

import { execFileSync } from 'node:child_process';

import { type Endpoint, type Inventory, keyOf, seenOf } from './inventory.ts';
import { type Event, type Reviewed, SEVERITIES, VERDICTS, VERSION, append, newBatch, now, problem } from './log.ts';
import { Refused, load } from './project.ts';
import type { Row } from './replay.ts';

/** The endpoint a method and path name, and the HEAD folded into it, if any. */
const resolve = (inventory: Inventory, rows: Row[], given: string, path: string, handler?: string): Endpoint[] => {
  const method = given.toUpperCase();
  const matches = inventory.endpoints.filter(
    e => e.method === method && e.path === path && (handler === undefined || e.handler === handler || keyOf(e)[2] === handler),
  );
  if (!matches.length) throw new Refused(`no endpoint ${method} ${path}${handler ? ` (${handler})` : ''} in the inventory`);
  if (matches.length > 1) throw new Refused(`${method} ${path} has several handlers (${matches.map(e => e.handler).join(', ')}): name one with --handler`);
  const e = matches[0]!;
  const row = rows.find(r => r.path === e.path && r.handler === e.handler && r.method === e.method);
  if (!row) throw new Refused(`${method} ${path} is shown with its GET: review GET ${path}`);
  const head = row.head ? inventory.endpoints.find(h => h.method === 'HEAD' && h.path === e.path && h.handler === e.handler) : undefined;
  return head ? [e, head] : [e];
};

const gitEmail = (project: string): string => {
  let email = '';
  try {
    email = execFileSync('git', ['config', 'user.email'], { cwd: project, encoding: 'utf8' }).trim();
  } catch {
    // no email configured: refused below
  }
  if (!email) throw new Refused('no git user.email: a Verdict names its reviewer, set it with `git config user.email`');
  return email;
};

export type Values = Record<string, string | boolean | undefined>;

export const appendVerdict = (project: string, values: Values, positionals: string[]) => {
  const [method, path] = positionals;
  if (!method || !path || positionals.length !== 2) throw new Refused('append needs <METHOD> <path>');
  const verdict = values.verdict as string | undefined;
  if (!verdict || !VERDICTS.includes(verdict as Reviewed['verdict'])) throw new Refused(`--verdict must be one of ${VERDICTS.join(', ')}`);
  if (values.severity !== undefined && !SEVERITIES.includes(values.severity as NonNullable<Reviewed['severity']>))
    throw new Refused(`--severity must be one of ${SEVERITIES.join(', ')}`);
  const { inventory, rows } = load(project);
  const endpoints = resolve(inventory, rows, method, path, values.handler as string | undefined);
  const by = gitEmail(project);
  const at = now();
  const events = endpoints.map(e => {
    const event: Record<string, unknown> = {
      v: VERSION,
      at,
      by,
      event: 'reviewed',
      batch: null,
      endpoint: keyOf(e),
      seen: seenOf(e, inventory.expected_access),
      verdict,
      reason: values.reason ?? '',
    };
    for (const k of ['severity', 'ticket', 'until']) if (values[k] !== undefined) event[k] = values[k];
    const wrong = problem(event);
    if (wrong) throw new Refused(wrong);
    return event as unknown as Event;
  });
  append(project, events);
  return `appended ${events.length} event${events.length === 1 ? '' : 's'}: ${verdict} ${method.toUpperCase()} ${path}\n`;
};

export const appendAgent = (project: string, model: string | undefined, input: string) => {
  if (!model) throw new Refused('--agent needs --model <id>');
  const { inventory, rows } = load(project);
  const batch = newBatch();
  const at = now();
  const events: Event[] = [];
  input.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let item: Record<string, unknown>;
    try {
      item = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Refused(`stdin line ${i + 1}: not valid JSON`);
    }
    if (item.event !== 'signal_raised' && item.event !== 'triaged') throw new Refused(`stdin line ${i + 1}: the agent appends only signal_raised or triaged`);
    if (typeof item.method !== 'string' || typeof item.path !== 'string') throw new Refused(`stdin line ${i + 1}: method and path are required`);
    for (const e of resolve(inventory, rows, item.method, item.path, item.handler as string | undefined)) {
      const event: Record<string, unknown> = { v: VERSION, at, by: `agent:${model}`, event: item.event, batch, endpoint: keyOf(e), seen: seenOf(e, inventory.expected_access) };
      if (item.event === 'signal_raised') Object.assign(event, { reason: item.reason, evidence: item.evidence });
      const wrong = problem(event);
      if (wrong) throw new Refused(`stdin line ${i + 1}: ${wrong}`);
      events.push(event as unknown as Event);
    }
  });
  if (!events.length) throw new Refused('no events on stdin');
  append(project, events);
  return `appended ${events.length} events in batch ${batch}\n`;
};

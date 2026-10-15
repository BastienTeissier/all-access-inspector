// review <status|append|app> <project>: the Review Queue and the Review Log from the command line. Never writes through git.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { type Endpoint, type Inventory, InventoryError, classification, keyOf, loadInventory, seenOf, toolsDir } from './inventory.ts';
import { type Event, type Reviewed, SEVERITIES, VERDICTS, VERSION, append, newBatch, now, problem, readLog } from './log.ts';
import { type Row, replay } from './replay.ts';
import { TIERS, queue } from './tiers.ts';

const USAGE = `usage:
  review status <project> [--json]
  review append <project> --verdict safe|accepted|finding --reason <text> [--severity low|medium|high] [--ticket <url>] [--until YYYY-MM-DD] [--handler <handler>] <METHOD> <path>
  review append <project> --agent --model <id>   (events as JSON lines on stdin)
<project> is the directory holding tools/access-inspector/inventory.json.`;

class Refused extends Error {}

const inventoryPath = (project: string) => join(toolsDir(project), 'inventory.json');

/** Inventory and log, or a refusal naming the first broken line. */
const load = (project: string): { inventory: Inventory; rows: Row[]; orphans: ReturnType<typeof replay>['orphans'] } => {
  const inventory = loadInventory(inventoryPath(project));
  const { events, errors } = readLog(project);
  if (errors.length) throw new Refused(errors.map(e => `reviews.jsonl line ${e.line}: ${e.message}`).join('\n'));
  const today = now().slice(0, 10);
  return { inventory, ...replay(inventory, events, today) };
};

const zones = (row: Row) => Object.values(row.dimensions).join(',');

const methods = (row: Row) => (row.head ? `${row.method},HEAD` : row.method);

/** Why the row is where it is: its Verdict when it has one, then every Signal it carries. */
const detail = (row: Row): string => {
  const notes: string[] = [];
  const verdict = row.verdict;
  if (verdict && row.state === 'outdated') {
    const was = verdict.seen;
    const what = row.expired
      ? `until ${verdict.until} has passed`
      : classification(was) === classification(row)
        ? `${was.authentication.raw ?? '-'} ${was.authorization.raw ?? '-'} → ${row.authentication.raw ?? '-'} ${row.authorization.raw ?? '-'}`
        : `was ${classification(was)}, now ${classification(row)}`;
    notes.push(`${verdict.verdict} by ${verdict.by} outdated: ${what}`);
  } else if (verdict?.verdict === 'finding') notes.push(`finding ${verdict.severity}: ${verdict.reason}`);
  notes.push(...row.signals.map(s => `${s.id}: ${s.text}`));
  if (row.agent?.event === 'triaged') notes.push('agent: no signal');
  return notes.join('; ');
};

/** One queued row as `status --json` prints it: the interface Triage reads, kept apart from the internal Row. */
const output = (row: Row) => ({
  key: row.key,
  method: row.method,
  head: row.head,
  path: row.path,
  handler: row.handler,
  authentication: row.authentication,
  authorization: row.authorization,
  dimensions: row.dimensions,
  unknown_reason: row.unknown_reason,
  inside: row.inside,
  state: row.state,
  moot: row.moot,
  verdict: row.verdict && {
    verdict: row.verdict.verdict,
    by: row.verdict.by,
    at: row.verdict.at,
    reason: row.verdict.reason,
    ...(row.verdict.severity ? { severity: row.verdict.severity } : {}),
  },
  signals: row.signals,
  tier: row.tier,
});

const status = (project: string, json: boolean): string => {
  const { inventory, rows, orphans } = load(project);
  const todo = queue(rows);
  if (json) return todo.map(r => `${JSON.stringify(output(r))}\n`).join('');
  const count = (state: Row['state']) => rows.filter(r => r.state === state).length;
  const out = [
    `${inventory.stack} · ${inventory.coverage} · ${inventory.endpoints.length} endpoints (${rows.length} rows, HEAD shown with its GET)`,
    `Verdicts: ${count('valid')} valid (${rows.filter(r => r.moot).length} moot), ${count('outdated')} outdated, ${orphans.length} orphaned`,
    `Review Queue: ${todo.length} rows`,
  ];
  for (const tier of Object.keys(TIERS).map(Number)) {
    const inTier = todo.filter(r => r.tier === tier);
    if (!inTier.length) continue;
    out.push('', `Tier ${tier} · ${TIERS[tier]} (${inTier.length})`);
    for (const r of inTier) out.push(`  ${methods(r).padEnd(8)} ${r.path}  ${zones(r)}  ${classification(r)}  ${detail(r)}`.trimEnd());
  }
  if (orphans.length) {
    out.push('', `Orphaned verdicts (${orphans.length})`);
    for (const o of orphans) out.push(`  ${o.verdict.verdict.padEnd(8)} ${o.key[0]} ${o.key[1]} (${o.key[2]})  ${o.verdict.reason}`);
  }
  return `${out.join('\n')}\n`;
};

/** The endpoint a method and path name, and the HEAD folded into it, if any. */
const resolve = (inventory: Inventory, rows: Row[], method: string, path: string, handler?: string): Endpoint[] => {
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

type Values = Record<string, string | boolean | undefined>;

const appendVerdict = (project: string, values: Values, positionals: string[]) => {
  const [method, path] = positionals;
  if (!method || !path || positionals.length !== 2) throw new Refused('append needs <METHOD> <path>');
  const verdict = values.verdict as string | undefined;
  if (!verdict || !VERDICTS.includes(verdict as Reviewed['verdict'])) throw new Refused(`--verdict must be one of ${VERDICTS.join(', ')}`);
  if (values.severity !== undefined && !SEVERITIES.includes(values.severity as NonNullable<Reviewed['severity']>))
    throw new Refused(`--severity must be one of ${SEVERITIES.join(', ')}`);
  const { inventory, rows } = load(project);
  const endpoints = resolve(inventory, rows, method.toUpperCase(), path, values.handler as string | undefined);
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

const appendAgent = (project: string, model: string | undefined, input: string) => {
  if (!model) throw new Refused('--agent needs --model <id>');
  const { inventory, rows } = load(project);
  const batch = newBatch();
  const at = now();
  const events: Event[] = [];
  input
    .split('\n')
    .filter(line => line.trim())
    .forEach((line, i) => {
      let item: Record<string, unknown>;
      try {
        item = JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new Refused(`stdin line ${i + 1}: not valid JSON`);
      }
      if (item.event !== 'signal_raised' && item.event !== 'triaged') throw new Refused(`stdin line ${i + 1}: the agent appends only signal_raised or triaged`);
      for (const e of resolve(inventory, rows, String(item.method), String(item.path), item.handler as string | undefined)) {
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

export const main = (argv: string[], stdin: () => string): { code: number; stdout: string; stderr: string } => {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        verdict: { type: 'string' },
        reason: { type: 'string' },
        severity: { type: 'string' },
        ticket: { type: 'string' },
        until: { type: 'string' },
        handler: { type: 'string' },
        agent: { type: 'boolean' },
        model: { type: 'string' },
      },
    });
    const [command, project, ...rest] = positionals;
    if (!project) throw new Refused(USAGE);
    if (command === 'status' && !rest.length) return { code: 0, stdout: status(project, values.json === true), stderr: '' };
    if (command === 'append' && values.agent) {
      if (values.verdict !== undefined) throw new Refused('--agent never gives a Verdict: it appends signal_raised or triaged only');
      return { code: 0, stdout: appendAgent(project, values.model, stdin()), stderr: '' };
    }
    if (command === 'append') return { code: 0, stdout: appendVerdict(project, values, rest), stderr: '' };
    if (command === 'app') throw new Refused('the review app is not available yet');
    throw new Refused(USAGE);
  } catch (error) {
    if (error instanceof Refused || error instanceof InventoryError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS'))
      return { code: 2, stdout: '', stderr: `${(error as Error).message}\n` };
    throw error;
  }
};

if (import.meta.main) {
  const result = main(process.argv.slice(2), () => readFileSync(0, 'utf8'));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

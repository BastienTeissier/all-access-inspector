// review <status|append|app> <project>: the Review Queue and the Review Log from the command line. Never writes through git.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { appendAgent, appendVerdict } from './append.ts';
import { InventoryError, classification } from './inventory.ts';
import { Refused, load } from './project.ts';
import type { Row } from './replay.ts';
import { TIERS, queue } from './tiers.ts';

const USAGE = `usage:
  review status <project> [--json]
  review append <project> --verdict safe|accepted|finding --reason <text> [--severity low|medium|high] [--ticket <url>] [--until YYYY-MM-DD] [--handler <handler>] <METHOD> <path>
  review append <project> --agent --model <id>   (events as JSON lines on stdin)
<project> is the directory holding tools/access-inspector/inventory.json.`;

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

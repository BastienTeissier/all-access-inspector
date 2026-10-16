// The app's projection: the review package's replay of inventory.json and reviews.jsonl, kept in a SQLite file that is
// rebuilt whenever either file changes. A cache only: deleting it loses nothing, the files are the truth (ADR 0004).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { type Inventory, type Key, keyText, toolsDir } from '../../../skills/all-access-inspector/review/src/inventory.ts';
import { type Logged, logPath, readLog } from '../../../skills/all-access-inspector/review/src/log.ts';
import { load } from '../../../skills/all-access-inspector/review/src/project.ts';
import type { Orphan, Row } from '../../../skills/all-access-inspector/review/src/replay.ts';
import { siblings } from '../../../skills/all-access-inspector/review/src/signals.ts';
import { queue as reviewQueue } from '../../../skills/all-access-inspector/review/src/tiers.ts';

// Next bundles this file, so its own location means nothing at run time: `review app` and the tests run from apps/review.
const VERSION_FILE = join(process.cwd(), '..', '..', 'skills', 'all-access-inspector', 'VERSION');

export interface Header {
  stack: string;
  coverage: string;
  endpoints: number;
  dimensions: boolean;
  valid: number;
  outdated: number;
  orphaned: number;
}

export interface Filters {
  zone?: string; // `<dimension>=<value>`
  tier?: string;
  signal?: string;
  state?: string;
  q?: string;
  view?: string; // `reviewed`: endpoints with a valid Verdict instead of the queue
}

/** A projected row: the replayed Row, plus the keys of its siblings. */
export type Projected = Row & { siblings: Key[] };

/** A row whose valid Verdict is a finding: replacing it takes a confirmation. */
export const openFinding = (r: Row): boolean => r.state === 'valid' && r.verdict?.verdict === 'finding';

/** A row as the reviewer reads it: its methods, HEAD folded, and its path. */
export const endpointName = (r: Row): string => `${r.head ? `${r.method},HEAD` : r.method} ${r.path}`;

/**
 * What saving the selection must be confirmed against: the open findings it would replace, named, and their keys as the
 * checkbox posts them. A confirmation counts only for the findings it named, so one appearing since is never replaced unseen.
 */
export const confirmation = (selection: Row[]): { label: string; value: string } | null => {
  const findings = selection.filter(openFinding);
  if (!findings.length) return null;
  const label = `Replace the open finding${findings.length === 1 ? '' : 's'} on ${findings.map(endpointName).join(', ')}`;
  return { label, value: JSON.stringify(findings.map(r => r.key)) };
};

export interface Projection {
  project: string;
  /** What could not be read, shown above the last good state. */
  error: string | null;
  db: DatabaseSync | null;
}

export const cachePath = (project: string): string =>
  join(homedir(), '.cache', 'all-access-inspector', `${createHash('sha256').update(project).digest('hex').slice(0, 16)}.sqlite`);

const inventoryPath = (project: string) => join(toolsDir(project), 'inventory.json');

/** What the cache was built from: when any of it differs, the cache is stale. */
const fingerprint = (project: string): Record<string, string> => {
  const stat = (path: string) => (existsSync(path) ? statSync(path) : null);
  const inventory = stat(inventoryPath(project));
  const log = stat(logPath(project));
  return {
    inventory_size: String(inventory?.size ?? -1),
    inventory_mtime: String(inventory?.mtimeMs ?? -1),
    log_size: String(log?.size ?? -1),
    log_mtime: String(log?.mtimeMs ?? -1),
    toolkit_version: readFileSync(VERSION_FILE, 'utf8').trim(),
    // the shape of the tables below: a cache of another shape is rebuilt, not read
    projection: '2',
    // an `accepted` Verdict goes outdated the day after its `until`: a new day is a new replay
    today: new Date().toISOString().slice(0, 10),
  };
};

const SCHEMA = `
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE endpoint(key TEXT PRIMARY KEY, method TEXT, path TEXT, handler TEXT, row TEXT, tier INT, signals TEXT, state TEXT, verdict TEXT, siblings TEXT, position INT);
  CREATE TABLE event(line INT PRIMARY KEY, at TEXT, by TEXT, event TEXT, batch TEXT, key TEXT, payload TEXT);
  CREATE TABLE orphan(key TEXT PRIMARY KEY, verdict TEXT);
  CREATE TABLE header(value TEXT);
`;

const build = (path: string, meta: Record<string, string>, inventory: Inventory, rows: Row[], orphans: Orphan[], events: Logged[]) => {
  const temp = `${path}.${process.pid}.tmp`;
  rmSync(temp, { force: true });
  const db = new DatabaseSync(temp);
  try {
    db.exec(SCHEMA);
    db.exec('BEGIN');
    const insertMeta = db.prepare('INSERT INTO meta VALUES (?, ?)');
    for (const [k, v] of Object.entries(meta)) insertMeta.run(k, v);
    const related = siblings(rows);
    // the package decides what is queued and in what order: the app only filters it
    const position = new Map(reviewQueue(rows).map((r, i) => [r, i]));
    const insertRow = db.prepare('INSERT INTO endpoint VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of rows) {
      const keys = (related.get(r) ?? []).map(s => s.key);
      insertRow.run(keyText(r.key), r.method, r.path, r.handler, JSON.stringify(r), r.tier, JSON.stringify(r.signals), r.state, r.verdict && JSON.stringify(r.verdict), JSON.stringify(keys), position.get(r) ?? null);
    }
    const insertEvent = db.prepare('INSERT INTO event VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const e of events) insertEvent.run(e.line, e.at, e.by, e.event, e.batch, keyText(e.endpoint), JSON.stringify(e));
    const insertOrphan = db.prepare('INSERT INTO orphan VALUES (?, ?)');
    for (const o of orphans) insertOrphan.run(keyText(o.key), JSON.stringify(o.verdict));
    const header: Header = {
      stack: inventory.stack,
      coverage: inventory.coverage,
      endpoints: inventory.endpoints.length,
      dimensions: rows.some(r => Object.keys(r.dimensions).length > 0),
      valid: rows.filter(r => r.state === 'valid').length,
      outdated: rows.filter(r => r.state === 'outdated').length,
      orphaned: orphans.length,
    };
    db.prepare('INSERT INTO header VALUES (?)').run(JSON.stringify(header));
    db.exec('COMMIT');
    db.close();
    renameSync(temp, path);
  } finally {
    if (db.isOpen) db.close();
    rmSync(temp, { force: true });
  }
};

let open: { path: string; db: DatabaseSync } | null = null;

const connect = (path: string): DatabaseSync | null => {
  if (open?.path === path) return open.db;
  open?.db.close();
  open = existsSync(path) ? { path, db: new DatabaseSync(path) } : null;
  return open?.db ?? null;
};

const stale = (db: DatabaseSync, meta: Record<string, string>): boolean => {
  const stored = Object.fromEntries(
    (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map(m => [m.key, m.value]),
  );
  return Object.entries(meta).some(([k, v]) => stored[k] !== v) || Object.keys(stored).length !== Object.keys(meta).length;
};

/** The projection of `project`, rebuilt when its files changed. A read failure keeps the last good state. */
export const project = (dir: string): Projection => {
  const abs = resolve(dir);
  const path = cachePath(abs);
  const meta = fingerprint(abs);
  let db = connect(path);
  if (db && !stale(db, meta)) return { project: abs, error: null, db };
  try {
    const { inventory, rows, orphans } = load(abs);
    const { events } = readLog(abs);
    mkdirSync(join(path, '..'), { recursive: true });
    build(path, meta, inventory, rows, orphans, events);
    // only now: until the new file is in place, the open handle is the last good state
    open?.db.close();
    open = null;
    db = connect(path);
    return { project: abs, error: null, db };
  } catch (error) {
    return { project: abs, error: (error as Error).message, db };
  }
};

const parse = (r: { row: string; siblings: string }): Projected => ({ ...(JSON.parse(r.row) as Row), siblings: JSON.parse(r.siblings) as Key[] });

export const header = (db: DatabaseSync): Header => JSON.parse((db.prepare('SELECT value FROM header').get() as { value: string }).value) as Header;

/** The Review Queue (or the reviewed view) under `filters`, in `review status` order. */
export const queue = (db: DatabaseSync, filters: Filters): Projected[] => {
  const where: string[] = [];
  const args: string[] = [];
  const add = (sql: string, ...values: string[]) => {
    where.push(sql);
    args.push(...values);
  };
  const reviewed = filters.view === 'reviewed';
  add(reviewed ? "state = 'valid'" : 'position IS NOT NULL');
  if (filters.tier) add('tier = ?', filters.tier);
  if (filters.state) add('state = ?', filters.state);
  if (filters.q) add('instr(path, ?) > 0', filters.q);
  if (filters.signal) add("EXISTS (SELECT 1 FROM json_each(signals) WHERE json_extract(value, '$.id') = ?)", filters.signal);
  if (filters.zone?.includes('=')) {
    const at = filters.zone.indexOf('=');
    add("EXISTS (SELECT 1 FROM json_each(row, '$.dimensions') WHERE key = ? AND value = ?)", filters.zone.slice(0, at), filters.zone.slice(at + 1));
  }
  const sql = `SELECT row, siblings FROM endpoint WHERE ${where.join(' AND ')} ORDER BY ${reviewed ? 'tier, path, method' : 'position'}`;
  return (db.prepare(sql).all(...args) as { row: string; siblings: string }[]).map(parse);
};

export const row = (db: DatabaseSync, key: string): Projected | null => {
  const r = db.prepare('SELECT row, siblings FROM endpoint WHERE key = ?').get(key) as { row: string; siblings: string } | undefined;
  return r ? parse(r) : null;
};

/** The events of one Review Key, newest first. */
export const history = (db: DatabaseSync, key: string): Logged[] =>
  (db.prepare('SELECT payload FROM event WHERE key = ? ORDER BY at DESC, line DESC').all(key) as { payload: string }[]).map(e => JSON.parse(e.payload) as Logged);

/** Every event of the log, newest first. */
export const events = (db: DatabaseSync): Logged[] =>
  (db.prepare('SELECT payload FROM event ORDER BY at DESC, line DESC').all() as { payload: string }[]).map(e => JSON.parse(e.payload) as Logged);

/** The Verdicts on keys the inventory no longer has. */
export const orphans = (db: DatabaseSync): Orphan[] =>
  (db.prepare('SELECT key, verdict FROM orphan ORDER BY key').all() as { key: string; verdict: string }[]).map(o => ({
    key: JSON.parse(o.key) as Key,
    verdict: JSON.parse(o.verdict) as Orphan['verdict'],
  }));

/** Every `<dimension>=<value>` zone present, for the zone filter. */
export const zones = (db: DatabaseSync): string[] =>
  (db.prepare("SELECT DISTINCT d.key || '=' || d.value AS zone FROM endpoint, json_each(endpoint.row, '$.dimensions') AS d ORDER BY zone").all() as { zone: string }[]).map(z => z.zone);

/** Lines of reviews.jsonl git does not have yet, or null outside a git work tree. Reads git, never writes through it. */
export const uncommitted = (dir: string): number | null => {
  const log = logPath(dir);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    git('rev-parse', '--is-inside-work-tree');
  } catch {
    return null;
  }
  if (!existsSync(log)) return 0;
  try {
    git('ls-files', '--error-unmatch', log);
    git('rev-parse', '--verify', '-q', 'HEAD');
  } catch {
    // untracked, or no commit yet: git has none of its lines
    return readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
  }
  return Number(git('diff', '--numstat', 'HEAD', '--', log).split('\t')[0] || 0);
};

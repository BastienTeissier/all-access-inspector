// The temporary project the e2e run reviews: django-demo's inventory and the sample log, committed.

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
export const CLI = join(REPO, 'skills', 'all-access-inspector', 'review', 'src', 'cli.ts');
export const INVENTORY = join(REPO, 'fixtures', 'django-demo', 'expected', 'inventory.json');
export const SAMPLE_LOG = join(REPO, 'skills', 'all-access-inspector', 'review', 'tests', 'samples', 'django-demo.reviews.jsonl');

/** Set by the global setup for the workers. */
export const dir = (): string => process.env.REVIEW_TEST_PROJECT!;
export const log = (): string => readFileSync(join(dir(), 'tools', 'access-inspector', 'reviews.jsonl'), 'utf8');

/** The environment the CLI and git run with: a temporary home and git identity. */
export const env = (): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: join(dir(), '..', 'home'),
  GIT_CONFIG_GLOBAL: join(dir(), '..', 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
});

/** Back to the committed sample log. */
export const reset = (): void => copyFileSync(SAMPLE_LOG, join(dir(), 'tools', 'access-inspector', 'reviews.jsonl'));

export const review = (...args: string[]): string => execFileSync(process.execPath, [CLI, ...args], { cwd: dir(), env: env(), encoding: 'utf8' });

export const status = (): { key: string[]; tier: number; state: string; method: string; head: boolean; path: string; handler: string; verdict: { verdict: string; reason: string } | null }[] =>
  review('status', dir(), '--json')
    .trimEnd()
    .split('\n')
    .map(l => JSON.parse(l));

/** The orphaned Verdicts as `review status` lists them, after its queue. */
export const orphans = (): { method: string; path: string; reason: string }[] => {
  const text = review('status', dir());
  const at = text.indexOf('\nOrphaned verdicts (');
  if (at < 0) return [];
  return text
    .slice(at + 1)
    .trimEnd()
    .split('\n')
    .slice(1)
    .map(l => {
      const [, method, path, reason] = /^ {2}\S+\s+(\S+) (\S+) \(.*?\) {2}(.*)$/.exec(l)!;
      return { method: method!, path: path!, reason: reason! };
    });
};

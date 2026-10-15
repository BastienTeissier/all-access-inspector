// A temporary project holding the django-demo inventory, and the review CLI run inside it as a user runs it.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect } from 'vitest';

const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts');
export const INVENTORY = join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'django-demo', 'expected', 'inventory.json');
export const SAMPLE_LOG = join(import.meta.dirname, 'samples', 'django-demo.reviews.jsonl');
export const GOLDEN = join(import.meta.dirname, 'expected', 'django-demo.status.txt');

export let project: string;
export let gitconfig: string;

/** A fresh project before each test of the calling file; after it, the inventory must be untouched. */
export const useProject = (): void => {
  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'review-'));
    project = join(root, 'django-demo');
    mkdirSync(join(project, 'tools', 'access-inspector'), { recursive: true });
    copyFileSync(INVENTORY, tools('inventory.json'));
    gitconfig = join(root, 'gitconfig');
    writeFileSync(gitconfig, '[user]\n\temail = reviewer@example.com\n\tname = Reviewer\n[init]\n\tdefaultBranch = main\n');
  });

  afterEach(() => {
    expect(readFileSync(tools('inventory.json'), 'utf8')).toBe(readFileSync(INVENTORY, 'utf8'));
  });
};

export const tools = (...parts: string[]) => join(project, 'tools', 'access-inspector', ...parts);
export const log = () => (existsSync(tools('reviews.jsonl')) ? readFileSync(tools('reviews.jsonl'), 'utf8') : '');

const env = () => ({ ...process.env, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' });

export const review = (args: string[], options: { cwd?: string; input?: string } = {}) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: options.cwd ?? project, env: env(), input: options.input, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

export const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env: env(), encoding: 'utf8' });

export const events = () =>
  log()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l) as Record<string, unknown>);

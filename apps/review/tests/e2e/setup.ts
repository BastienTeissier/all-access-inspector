// Starts `review app` on a temporary committed copy of django-demo, the way a user starts it, and stops it after the run.

import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLI, INVENTORY, SAMPLE_LOG, env } from './project.ts';

export default async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'review-app-'));
  const project = join(root, 'django-demo');
  const tools = join(project, 'tools', 'access-inspector');
  mkdirSync(tools, { recursive: true });
  copyFileSync(INVENTORY, join(tools, 'inventory.json'));
  copyFileSync(SAMPLE_LOG, join(tools, 'reviews.jsonl'));
  writeFileSync(join(tools, '.gitattributes'), 'reviews.jsonl merge=union\n');
  writeFileSync(join(root, 'gitconfig'), '[user]\n\temail = reviewer@example.com\n\tname = Reviewer\n[init]\n\tdefaultBranch = main\n');
  process.env.REVIEW_TEST_PROJECT = project;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, env: env() });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'fit');

  const app = spawn(process.execPath, [CLI, 'app', project], { env: env(), stdio: ['ignore', 'pipe', 'inherit'] });
  const url = await new Promise<string>((done, fail) => {
    let out = '';
    app.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      const found = /http:\/\/127\.0\.0\.1:\d+/.exec(out);
      if (found && out.includes('Ready')) done(found[0]);
    });
    app.on('exit', code => fail(new Error(`review app exited with ${code}: ${out}`)));
  });
  process.env.REVIEW_URL = url;
  return () => {
    app.kill('SIGTERM');
  };
}

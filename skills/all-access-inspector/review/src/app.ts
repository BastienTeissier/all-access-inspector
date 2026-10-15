// review app: the local review app of a toolkit checkout, on 127.0.0.1, built first when its build is missing or older
// than its sources. It is not shipped with the skill: a vendored copy of this package has no apps/review beside it.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

import { loadInventory, toolsDir } from './inventory.ts';
import { Refused } from './project.ts';

export const APP_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'apps', 'review');
const SOURCES = [join(APP_DIR, 'app'), join(APP_DIR, 'lib'), join(APP_DIR, 'next.config.ts'), join(APP_DIR, 'package.json'), import.meta.dirname];
const FIRST_PORT = 4377;

export interface App {
  dir: string;
  project: string;
}

const newest = (path: string): number => {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(stat.mtimeMs, ...readdirSync(path).map(name => newest(join(path, name))));
};

/** Checks the checkout and the project, and builds the app when needed; the build's output goes to stderr. */
export const prepare = (project: string, appDir = APP_DIR): App => {
  if (!existsSync(join(appDir, 'package.json'))) throw new Refused('the review app runs from a checkout of all-access-inspector');
  loadInventory(join(toolsDir(project), 'inventory.json'));
  if (!existsSync(join(appDir, 'node_modules', 'next'))) throw new Refused(`the review app is not installed: run \`make install-review\` in ${resolve(appDir, '..', '..')}`);
  const built = join(appDir, '.next', 'BUILD_ID');
  if (!existsSync(built) || statSync(built).mtimeMs < Math.max(...SOURCES.filter(existsSync).map(newest))) {
    process.stderr.write('review app: building…\n');
    execFileSync(process.execPath, [join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
      cwd: appDir,
      stdio: ['ignore', process.stderr, process.stderr],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
  }
  return { dir: appDir, project: resolve(project) };
};

const free = (port: number): Promise<boolean> =>
  new Promise(done => {
    const server = createServer()
      .once('error', () => done(false))
      .listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });

/** Starts the app on the first free port from 4377, localhost only; resolves with its exit code. */
export const serve = async (app: App): Promise<number> => {
  let port = FIRST_PORT;
  while (!(await free(port))) port += 1;
  process.stdout.write(`review app: http://127.0.0.1:${port} (${app.project})\n`);
  const child = spawn(process.execPath, [join(app.dir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: app.dir,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', REVIEW_PROJECT: app.project },
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  return new Promise(done => child.on('exit', code => done(code ?? 0)));
};

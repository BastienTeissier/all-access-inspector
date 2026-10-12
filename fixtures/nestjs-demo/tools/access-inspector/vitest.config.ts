// Runs run.spec.ts with the project's own vitest config: its transform, aliases and tsconfig paths, none of its
// tests, setup files, test environment or coverage.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ViteUserConfig, defineConfig } from 'vitest/config';

const ROOT = process.cwd(); // inspect.sh runs from the directory that holds package.json
const CONFIGS = ['vitest.config', 'vite.config'].flatMap(n => ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map(e => `${n}.${e}`));

interface Vite {
  loadConfigFromFile(env: unknown, file: string, root: string): Promise<{ config: ViteUserConfig } | null>;
}

export default defineConfig(async env => {
  const file = CONFIGS.map(name => join(ROOT, name)).find(existsSync);
  // vite is vitest's dependency, not always the project's: load it from where vitest resolves it.
  const vitest = createRequire(join(ROOT, 'package.json')).resolve('vitest/package.json');
  const vite = (await import(pathToFileURL(createRequire(vitest).resolve('vite')).href)) as Vite;
  const project = file === undefined ? {} : ((await vite.loadConfigFromFile(env, file, ROOT))?.config ?? {});
  const {
    projects: _projects,
    include: _include,
    exclude: _exclude,
    setupFiles: _setupFiles,
    globalSetup: _globalSetup,
    env: _env,
    coverage: _coverage,
    reporters: _reporters,
    ...test
  } = project.test ?? {};
  return {
    ...project,
    root: ROOT,
    test: {
      ...test,
      include: ['tools/access-inspector/run.spec.ts'],
      globals: true,
      watch: false,
      reporters: ['default'],
      testTimeout: 600_000,
    },
  };
});

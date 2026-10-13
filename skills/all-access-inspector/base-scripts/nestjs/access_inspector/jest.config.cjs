// Runs run.spec.ts with the project's own jest config: its transform and moduleNameMapper, none of its tests,
// setup files or coverage.

const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.cwd(); // inspect.sh runs from the directory that holds package.json
const CONFIGS = ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.json'];

const project = async () => {
  const file = CONFIGS.map(name => join(ROOT, name)).find(existsSync);
  if (file === undefined) {
    if (existsSync(join(ROOT, 'jest.config.ts'))) {
      throw new Error('jest.config.ts is not read: port its transform and moduleNameMapper into this file');
    }
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).jest ?? {};
  }
  const loaded = file.endsWith('.json') ? JSON.parse(readFileSync(file, 'utf8')) : (await import(pathToFileURL(file).href)).default;
  return typeof loaded === 'function' ? await loaded() : loaded;
};

module.exports = async () => {
  const {
    projects: _projects,
    testRegex: _testRegex,
    testMatch: _testMatch,
    roots: _roots,
    setupFiles: _setupFiles,
    setupFilesAfterEnv: _setupFilesAfterEnv,
    globalSetup: _globalSetup,
    globalTeardown: _globalTeardown,
    collectCoverage: _collectCoverage,
    reporters: _reporters,
    ...config
  } = await project();
  // <rootDir> in the project's mappings meant the project's rootDir; this config's rootDir is the package root.
  const rootDir = resolve(ROOT, config.rootDir ?? '.');
  const mapper = Object.fromEntries(
    Object.entries(config.moduleNameMapper ?? {}).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.map(x => x.replaceAll('<rootDir>', rootDir)) : v.replaceAll('<rootDir>', rootDir),
    ]),
  );
  return {
    ...config,
    rootDir: ROOT,
    testMatch: ['<rootDir>/tools/access-inspector/run.spec.ts'],
    // The Base Script imports its siblings as ./name.js, as Node ESM requires.
    moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1', ...mapper },
    testTimeout: 600_000,
  };
};

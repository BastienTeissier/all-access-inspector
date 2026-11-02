// Map Introspect harness: `tools/access-inspector/inspect.sh map` runs this single test through the project's own
// test runner, as it runs the Adapted Script's run.spec.ts.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BootError, ROOT, boot } from '../access-inspector/boot.js';
import { NEUTRAL, RECOGNITION, RuleError, checkRules } from '../access-inspector/rules.js';
import { build, rows } from './introspect.js';
import { MapRuleError, type Runtime, check, toCanonicalJson } from './runtime.js';

declare const test: (name: string, fn: () => Promise<void>, timeout?: number) => void;

const HERE = 'tools/access-map';
const OUTPUT = join(ROOT, HERE, 'runtime.json');
const COMMITTED = `${HERE}/runtime.json`;
const COMMAND = 'tools/access-inspector/inspect.sh map';

const main = async (mode: string, out: string[], err: string[]): Promise<number> => {
  let before: Runtime | undefined;
  let result: Runtime;
  let diff: string[] = [];
  try {
    if (mode === 'check') {
      if (!existsSync(OUTPUT)) throw new MapRuleError(`${COMMITTED} not found; generate it first with \`${COMMAND}\` and commit it`);
      try {
        before = JSON.parse(readFileSync(OUTPUT, 'utf8')) as Runtime;
      } catch (error) {
        throw new MapRuleError(`cannot read the committed runtime ${COMMITTED}: ${String(error)}`);
      }
    }
    checkRules(RECOGNITION, NEUTRAL, ROOT);
    const booted = await boot();
    try {
      result = build(await rows(booted), readFileSync(join(ROOT, 'tools/access-inspector/VERSION'), 'utf8').trim());
    } finally {
      await booted.app.close().catch(() => undefined);
    }
    if (before !== undefined) diff = check(before, result);
  } catch (error) {
    if (!(error instanceof MapRuleError || error instanceof RuleError)) {
      const cause = error instanceof BootError ? (error.cause ?? error) : error;
      err.push(cause instanceof Error ? (cause.stack ?? String(cause)) : String(cause));
    }
    err.push(`access-map: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (before !== undefined) {
    if (diff.length === 0) {
      out.push('runtime up to date');
      return 0;
    }
    out.push(diff.join('\n'));
    out.push(`\n${COMMITTED} differs from what this code declares.\nIf the change is intended, run \`${COMMAND}\` and commit ${COMMITTED}.`);
    return 1;
  }
  writeFileSync(`${OUTPUT}.tmp`, toCanonicalJson(result));
  renameSync(`${OUTPUT}.tmp`, OUTPUT);
  return 0;
};

test(
  'access map',
  async () => {
    const dir = process.env.ACCESS_INSPECTOR_OUT;
    if (!dir) throw new Error(`run ${COMMAND}; this file is not a project test`);
    const [out, err]: [string[], string[]] = [[], []];
    const status = await main(process.env.ACCESS_MAP_MODE ?? 'write', out, err);
    const lines = (xs: string[]): string => xs.map(x => `${x}\n`).join('');
    writeFileSync(join(dir, 'stdout'), lines(out));
    writeFileSync(join(dir, 'stderr'), lines(err));
    writeFileSync(join(dir, 'status'), String(status));
  },
  600_000,
);

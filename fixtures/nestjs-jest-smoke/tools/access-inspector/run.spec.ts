// Adapted Script harness: inspect.sh runs this single test through the project's own test runner, which gives
// it the project's transform and path aliases. The result travels through files, since a runner only exits 0 or 1.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BootError, type Booted, HERE, ROOT, boot } from './boot.js';
import { classify, passportGuards } from './classify.js';
import { discover } from './discovery.js';
import { DIMENSIONS, MissingDimension, assign } from './dimensions.js';
import {
  type Endpoint,
  type Inventory,
  SCHEMA_VERSION,
  ValidationError,
  canonical,
  check,
  compact,
  compareEndpoints,
  fromJson,
  isUnknown,
  toCanonicalJson,
  validate,
} from './inventory.js';
import { NEUTRAL, RECOGNITION, RuleError, checkRules, methods, resolveAccess } from './rules.js';
import { render } from './table.js';

declare const test: (name: string, fn: () => Promise<void>, timeout?: number) => void;

const OUTPUT = join(ROOT, HERE, 'inventory.json');
const COMMITTED = `${HERE}/inventory.json`;
const COMMAND = `${HERE}/inspect.sh`;

const build = async ({ app, environment, watched }: Booted): Promise<Inventory> => {
  const passport = await passportGuards();
  const endpoints: Endpoint[] = [];
  for (const raw of discover(app, watched)) {
    const { findings, metadata } = classify(raw, app, passport);
    for (const method of methods(findings, raw.method, raw.path, metadata)) {
      const [authentication, authorization, reason] = resolveAccess(findings, method, raw.path, metadata);
      const endpoint: Endpoint = {
        method,
        path: raw.path,
        handler: raw.handler,
        authentication,
        authorization,
        dimensions: {},
        unknown_reason: reason,
      };
      endpoints.push({ ...endpoint, dimensions: assign(endpoint) });
    }
  }
  const express = app.getHttpAdapter().getType() === 'express';
  return {
    schema_version: SCHEMA_VERSION,
    stack: 'nestjs',
    discovery_mode: 'runtime',
    coverage: express ? 'complete' : 'best-effort',
    coverage_note: express ? null : 'routes registered on the HTTP adapter outside Nest are not listed',
    base_script: { stack: 'nestjs', version: readFileSync(join(ROOT, HERE, 'VERSION'), 'utf8').trim() },
    boot_environment: environment,
    project_dimensions: DIMENSIONS,
    endpoints: endpoints.sort(compareEndpoints),
  };
};

const main = async (mode: string, out: string[], err: string[]): Promise<number> => {
  let before: Inventory | undefined;
  if (mode === 'check') {
    // an unusable Committed Inventory fails before paying for the boot
    if (!existsSync(OUTPUT)) {
      err.push(`access-inspector: ${COMMITTED} not found; generate it first with \`${COMMAND}\` and commit it`);
      return 2;
    }
    try {
      before = fromJson(readFileSync(OUTPUT, 'utf8'));
    } catch (error) {
      err.push(`access-inspector: cannot read ${COMMITTED}: ${String(error)}`);
      return 2;
    }
  }
  let result: Inventory;
  try {
    checkRules(RECOGNITION, NEUTRAL, ROOT);
    const booted = await boot();
    try {
      result = await build(booted);
    } finally {
      await booted.app.close().catch(() => undefined);
    }
    validate(result);
  } catch (error) {
    if (error instanceof RuleError || error instanceof MissingDimension || error instanceof ValidationError) {
      err.push(`access-inspector: ${error.message}`);
    } else {
      const cause = error instanceof BootError ? (error.cause ?? error) : error;
      err.push(cause instanceof Error ? (cause.stack ?? String(cause)) : String(cause));
      err.push(`access-inspector: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 2;
  }
  if (before !== undefined) {
    const diff = check(before, result);
    if (diff.length === 0) {
      out.push('inventory up to date');
      return 0;
    }
    out.push(diff.join('\n'));
    out.push(
      `\n${COMMITTED} differs from the endpoints this code serves.` +
        `\nIf the change is intended, run \`${COMMAND}\` and commit ${COMMITTED}.`,
    );
    return 1;
  }
  if (mode === 'table') {
    out.push(render(result));
  } else if (mode === 'unknowns') {
    out.push(...canonical(result).endpoints.filter(isUnknown).map(compact));
  } else {
    writeFileSync(`${OUTPUT}.tmp`, toCanonicalJson(result));
    renameSync(`${OUTPUT}.tmp`, OUTPUT);
  }
  return 0;
};

test(
  'access inspector',
  async () => {
    const dir = process.env.ACCESS_INSPECTOR_OUT;
    if (!dir) throw new Error('run tools/access-inspector/inspect.sh; this file is not a project test');
    const [out, err]: [string[], string[]] = [[], []];
    const status = await main(process.env.ACCESS_INSPECTOR_MODE ?? 'write', out, err);
    const lines = (xs: string[]): string => xs.map(x => `${x}\n`).join('');
    writeFileSync(join(dir, 'stdout'), lines(out));
    writeFileSync(join(dir, 'stderr'), lines(err));
    writeFileSync(join(dir, 'status'), String(status));
  },
  600_000,
);

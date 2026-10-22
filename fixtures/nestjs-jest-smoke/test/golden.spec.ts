// Golden-file test: the vendored Adapted Script runs through jest, in a copy of this fixture.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = join(__dirname, '..');
const EXPECTED = join(FIXTURE, 'expected', 'inventory.json');

it('nestjs jest smoke', () => {
  const project = join(mkdtempSync(join(tmpdir(), 'nestjs-jest-smoke-')), 'nestjs-jest-smoke');
  const skip = new Set(['node_modules', 'test', 'expected']);
  cpSync(FIXTURE, project, { recursive: true, filter: source => !skip.has(source.slice(FIXTURE.length + 1)) });
  symlinkSync(join(FIXTURE, 'node_modules'), join(project, 'node_modules'));
  const result = spawnSync(join(project, 'tools', 'access-inspector', 'inspect.sh'), { cwd: project, encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const written = readFileSync(join(project, 'tools', 'access-inspector', 'inventory.json'), 'utf8');
  expect(written).toBe(readFileSync(EXPECTED, 'utf8'));
  const rows = (JSON.parse(written) as { endpoints: { method: string; path: string; authentication: { rule: string } }[] }).endpoints;
  expect(rows.map(e => `${e.method} ${e.path} ${e.authentication.rule}`)).toEqual([
    'POST /orders recognition:api_key',
    'GET /ping builtin:no_check',
    'HEAD /ping builtin:no_check',
  ]);
}, 120_000);

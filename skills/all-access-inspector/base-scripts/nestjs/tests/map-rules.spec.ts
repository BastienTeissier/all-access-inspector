import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';

import * as project from '../access_map/project.js';
import { lineOf } from '../access_map/runtime.js';

const RULES = ['roles', 'includes', 'scopes', 'scoped', 'capabilities'] as const;
const SAMPLE: Record<string, string> = {
  'src/auth/role.enum.ts': "export enum Role {\n  Admin = 'admin',\n  Editor = 'editor',\n}\n",
  'src/auth/roles.guard.ts': "    return role === 'admin' || roles.includes(role);\n",
  'src/orders/orders.service.ts': '    return this.orders.find({ where: { companyId: user.companyId } });\n',
  'src/orders/orders.controller.ts': "  @Get('export')\n  export() {\n",
};

/** The commented example of one Map Rule, as the body of that rule. */
const example = (rule: string): string => {
  const source = readFileSync(join(import.meta.dirname, '../access_map/project.ts'), 'utf8');
  const doc = source.slice(0, source.indexOf(`export const ${rule} = `));
  const block = doc.slice(doc.lastIndexOf('/**'));
  return block
    .split('\n')
    .filter(line => line.startsWith(' *   '))
    .map(line => line.slice(5))
    .join('\n');
};

test('Map Rules ship empty', () => {
  for (const rule of RULES) expect(project[rule](), rule).toEqual([]);
  expect(project.RELATION_RULES).toEqual({});
});

test('Map Rule examples return facts with at', () => {
  const root = mkdtempSync(join(tmpdir(), 'map-rules-'));
  for (const [path, text] of Object.entries(SAMPLE)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const Role = { Admin: 'admin', Editor: 'editor' };
  for (const rule of RULES) {
    const found = new Function('ROOT', 'lineOf', 'Role', example(rule))(root, lineOf, Role) as { at: string }[];
    expect(found.length, rule).toBeGreaterThan(0);
    for (const fact of found) expect(fact.at, rule).toMatch(/^[^\s:]+:\d+$/);
  }
});

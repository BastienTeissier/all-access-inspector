import { expect, test } from 'vitest';

import { render } from '../access_inspector/table.js';
import { load } from './samples.js';

test('marks unknowns and layers', () => {
  const lines = render(load('canonical.json')).split('\n');
  expect(lines[0]!.split(/\s+/).filter(Boolean)).toEqual(['METHOD', 'PATH', 'AUTHENTICATION', 'AUTHORIZATION', 'HANDLER', 'DIMENSIONS']);
  expect(lines).toHaveLength(8);
  const report = lines.find(line => line.includes('/api/reports/{slug}'))!;
  expect(report.startsWith('?')).toBe(true);
  expect(report.split(/\s+/).slice(3, 5)).toEqual(['required@global', 'unknown@method']);
  expect(lines.every(line => line === line.trimEnd())).toBe(true);
});

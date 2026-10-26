// Fixed-width terminal table rendered from an inventory; never written to disk.

import { type Axis, type Inventory, compareEndpoints, isUnknown } from './inventory.js';

const HEADER = ['', 'METHOD', 'PATH', 'AUTHENTICATION', 'AUTHORIZATION', 'HANDLER', 'DIMENSIONS'];

export const render = (inventory: Inventory): string => {
  const rows = [
    HEADER,
    ...[...inventory.endpoints].sort(compareEndpoints).map(e => [
      isUnknown(e) ? '?' : '',
      e.method,
      e.path,
      axis(e.authentication),
      axis(e.authorization),
      e.handler,
      Object.entries(e.dimensions)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
    ]),
  ];
  const widths = HEADER.map((_, i) => Math.max(...rows.map(row => [...row[i]!].length)));
  return rows.map(row => row.map((c, i) => c + ' '.repeat(widths[i]! - [...c].length)).join('  ').trimEnd()).join('\n');
};

const axis = (a: Axis): string => (a.layer ? `${a.value}@${a.layer}` : a.value);

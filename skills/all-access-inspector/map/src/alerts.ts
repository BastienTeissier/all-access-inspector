// Alerts: what to look at first on the map, computed only, in the order of plan §1.

import type { Key } from '../../review/src/inventory.ts';
import type { CellKey } from '../../review/src/log.ts';
import type { CellAgent } from '../../review/src/replay.ts';
import { SIGNAL_IDS } from '../../review/src/signals.ts';
import type { Cell } from './cells.ts';
import type { MapEndpoint } from './join.ts';

export const ALERT_KINDS = ['undecided', 'finding', 'open', 'uncovered', 'agent', 'signal', 'outside_expected'] as const;

export interface Alert {
  kind: (typeof ALERT_KINDS)[number];
  label: string;
  text: string;
  cell?: CellKey;
  endpoint?: Key;
}

export const SIGNAL_LABELS: Record<(typeof SIGNAL_IDS)[number], string> = {
  outside_expected: 'Outside its expected access',
  unknown: 'Unknown check',
  sibling: 'Differs from its siblings',
  open_write: 'Open write',
  agent: 'Agent signal',
  id_without_authz: 'Id without authorization',
  open_read: 'Open read',
};

const where = (e: MapEndpoint) => `${e.method} ${e.path}`;

export const alerts = (cells: Cell[], agents: CellAgent[], endpoints: MapEndpoint[], covered: Set<MapEndpoint>, name: (cell: CellKey) => string): Alert[] => {
  const out: Alert[] = [];
  for (const c of cells)
    if (c.state === 'partial' && c.decision?.state !== 'valid')
      out.push({ kind: 'undecided', label: 'Partial, not decided', text: `${name([c.capability, c.role])}: reaches some endpoints, not all`, cell: [c.capability, c.role] });
  for (const c of cells) {
    const d = c.decision;
    if (d?.state === 'valid' && d.decision.verdict === 'finding')
      out.push({ kind: 'finding', label: `Finding ${d.decision.severity ?? ''}`.trim(), text: `${name(d.key)}: ${d.decision.reason}`, cell: d.key });
  }
  for (const c of cells)
    if (c.state === 'open') out.push({ kind: 'open', label: 'Open', text: `${name([c.capability, c.role])}: decided in code the map cannot read`, cell: [c.capability, c.role] });
  for (const e of endpoints)
    if (!covered.has(e)) out.push({ kind: 'uncovered', label: 'Behind no capability', text: where(e), endpoint: e.key });
  for (const a of agents)
    if (a.event.event === 'signal_raised') out.push({ kind: 'agent', label: 'Agent signal', text: `${name(a.key)}: ${a.event.reason}`, cell: a.key });
  for (const id of SIGNAL_IDS)
    for (const e of endpoints)
      for (const s of e.signals.filter(s => s.id === id)) out.push({ kind: 'signal', label: SIGNAL_LABELS[id], text: `${where(e)}: ${s.text}`, endpoint: e.key });
  for (const e of endpoints)
    if (e.inside === false) out.push({ kind: 'outside_expected', label: 'Outside expected access', text: where(e), endpoint: e.key });
  return out;
};

// Alerts: what only the map raises, in the order of plan §1; review signals are counted for the queue, never listed here.

import type { Key } from '../../review/src/inventory.ts';
import type { CellKey } from '../../review/src/log.ts';
import type { CellAgent } from '../../review/src/replay.ts';
import type { Capability, Cell } from './cells.ts';
import type { MapEndpoint } from './join.ts';

export const ALERT_KINDS = ['undecided', 'finding', 'open'] as const;

export interface Alert {
  kind: (typeof ALERT_KINDS)[number];
  label: string;
  text: string;
  cell: CellKey;
}

/** The Review Queue's share of the map: every inventory signal and open agent signal, and the endpoints they sit on. */
export interface Queue {
  signals: number;
  endpoints: Key[];
}

export const alerts = (cells: Cell[], name: (cell: CellKey) => string): Alert[] => {
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
  return out;
};

/** An agent signal on a cell counts once and sits on the cell capability's endpoints; a later triage closes it. */
export const queue = (endpoints: MapEndpoint[], agents: CellAgent[], found: { cap: Capability; found: MapEndpoint[] }[]): Queue => {
  const open = agents.filter(a => a.event.event === 'signal_raised');
  const on = new Set([...endpoints.filter(e => e.signals.length), ...open.flatMap(a => found.find(f => f.cap.id === a.key[0])?.found ?? [])]);
  return {
    signals: endpoints.reduce((n, e) => n + e.signals.length, 0) + open.length,
    endpoints: endpoints.filter(e => on.has(e)).map(e => e.key),
  };
};

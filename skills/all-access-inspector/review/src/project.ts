// A project as the review reads it: its inventory replayed with its Review Log, or a refusal.

import { type Inventory, inventoryPath, loadInventory } from './inventory.ts';
import { type Logged, type LoggedCell, readLog, today } from './log.ts';
import { type Orphan, type Row, replay } from './replay.ts';

/** A refusal: the CLI prints it and exits 2, nothing written. */
export class Refused extends Error {}

/** Inventory and log, the log replayed against the inventory, or a refusal naming the first broken line. */
export const load = (project: string): { inventory: Inventory; events: Logged[]; cells: LoggedCell[]; rows: Row[]; orphans: Orphan[] } => {
  const inventory = loadInventory(inventoryPath(project));
  const { events, cells, errors } = readLog(project);
  if (errors.length) throw new Refused(errors.map(e => `reviews.jsonl line ${e.line}: ${e.message}`).join('\n'));
  return { inventory, events, cells, ...replay(inventory, events, today()) };
};

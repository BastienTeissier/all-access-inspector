// A project as the review reads it: its inventory replayed with its Review Log, or a refusal.

import { join } from 'node:path';

import { type Inventory, loadInventory, toolsDir } from './inventory.ts';
import { now, readLog } from './log.ts';
import { type Row, replay } from './replay.ts';

/** A refusal: the CLI prints it and exits 2, nothing written. */
export class Refused extends Error {}

const inventoryPath = (project: string) => join(toolsDir(project), 'inventory.json');

/** Inventory and log, or a refusal naming the first broken line. */
export const load = (project: string): { inventory: Inventory; rows: Row[]; orphans: ReturnType<typeof replay>['orphans'] } => {
  const inventory = loadInventory(inventoryPath(project));
  const { events, errors } = readLog(project);
  if (errors.length) throw new Refused(errors.map(e => `reviews.jsonl line ${e.line}: ${e.message}`).join('\n'));
  const today = now().slice(0, 10);
  return { inventory, ...replay(inventory, events, today) };
};

// The interface `review status --json` prints, apart from the CLI so the access map and the app can read it without it.

import type { Row } from './replay.ts';
import { RULE_TIER } from './tiers.ts';

/**
 * One queued row as `status --json` prints it: the interface Triage reads, kept apart from the internal Row.
 * `agent` is null when no Agent read the row, and also when its last read no longer counts: the row has a valid Verdict,
 * or its check changed since. `triage` says whether Triage reads the row: no valid Verdict, no authorization rule
 * deciding it alone, and no Agent read that still counts.
 */
export const output = (row: Row) => ({
  key: row.key,
  method: row.method,
  head: row.head,
  path: row.path,
  handler: row.handler,
  authentication: row.authentication,
  authorization: row.authorization,
  dimensions: row.dimensions,
  unknown_reason: row.unknown_reason,
  inside: row.inside,
  state: row.state,
  moot: row.moot,
  verdict: row.verdict && {
    verdict: row.verdict.verdict,
    by: row.verdict.by,
    at: row.verdict.at,
    reason: row.verdict.reason,
    ...(row.verdict.severity ? { severity: row.verdict.severity } : {}),
  },
  agent: row.agent
    ? {
        event: row.agent.event,
        by: row.agent.by,
        at: row.agent.at,
        ...(row.agent.event === 'signal_raised' ? { reason: row.agent.reason, evidence: row.agent.evidence } : {}),
      }
    : null,
  signals: row.signals,
  tier: row.tier,
  triage: row.state !== 'valid' && row.tier !== RULE_TIER && !row.agent,
});

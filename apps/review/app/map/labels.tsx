// The words of the static access map (map/page.html), so both pages read the same.

import type { PageEndpoint } from '../../../../skills/all-access-inspector/map/src/data.ts';
import type { Role } from '../../../../skills/all-access-inspector/map/src/roles.ts';

export const STATE: Record<string, [string, string]> = {
  pass: ['Yes', 'reaches every endpoint'],
  partial: ['Part', 'reaches some endpoints, not all'],
  no: ['—', 'reaches none'],
  off: ['Off', 'switched off in code'],
  open: ['?', 'decided in code the map cannot read'],
};

export const BASIS: Record<string, string> = {
  extracted: 'read from the code',
  rule: 'from a reviewed recognition rule',
  inferred: 'inferred by a heuristic',
  curated: 'hand-written in vocabulary.json',
  open: 'not resolved',
};

const WHO: Record<string, string> = {
  anyone: 'anyone',
  signed_in: 'any signed-in user',
  staff: 'staff',
  groups: 'groups',
  superuser: 'superuser only',
  nobody: 'nobody',
  custom: 'decided in code',
};

export const KINDS: Record<string, string> = {
  undecided: 'Partial, not decided',
  finding: 'Findings',
  open: 'Not resolved',
  uncovered: 'Behind no capability',
  agent: 'Agent signals',
  signal: 'Inspector signals',
  outside_expected: 'Outside expected access',
};

/** A cell's URL: the Roles tab with its panel open. */
export const cellHref = (cap: string, role: string): string => `/map?tab=roles&cap=${encodeURIComponent(cap)}&role=${encodeURIComponent(role)}`;

export const StateChip = ({ state, basis }: { state: string; basis: string }) => <span className={`state c-${state} b-${basis}`}>{STATE[state]?.[0]}</span>;

export const Who = ({ who, roles }: { who: PageEndpoint['who']; roles: Role[] }) => {
  const name =
    who.kind === 'groups'
      ? (who.roles ?? []).map(r => roles.find(x => x.id === r)?.name ?? r).join(', ') + (who.custom ? ' + code' : '') || 'no group'
      : WHO[who.kind];
  return (
    <span className={`who ${who.kind} b-${who.basis}`} title={who.how}>
      {name}
    </span>
  );
};

// map check: every problem that fails CI, then coverage and open findings. The CLI prints it, the review app shows it.

import { type Key, keyText } from '../../review/src/inventory.ts';
import { byPath } from '../../review/src/tiers.ts';
import { type Options, type Project, cellLabel, project } from './data.ts';
import { runtimeKey } from './runtime.ts';
import { duplicates, missingTerms, staleReferences } from './vocabulary.ts';

export interface Check {
  code: number;
  stdout: string;
  problems: string[];
}

/** Every problem that fails CI, then coverage and open findings, which never do; `thirdParty` lists the third-party gaps one by one. */
export const check = (dir: string, options: Options & { thirdParty?: boolean } = {}): Check => checkProject(project(dir, options), dir, options.thirdParty);

/** `check` on a project already read: the app checks the project it draws. */
export const checkProject = (p: Project, dir: string, thirdParty = false): Check => {
  const name = cellLabel(p.caps, p.roles);
  const rows = new Set(p.endpoints.map(e => runtimeKey({ method: e.key[0], path: e.path, handler: e.handler })));
  const problems = [
    ...staleReferences(dir, p.vocabulary),
    ...duplicates(p.vocabulary, p.runtime, p.derived.map(c => c.id)),
    ...p.runtime.endpoints.filter(e => !rows.has(runtimeKey(e))).map(e => `runtime endpoint ${runtimeKey(e)} is not in the inventory, run the Map Introspect again`),
    ...p.found.flatMap(f => f.missing.map(e => `capability ${f.cap.id} names ${e.join(' ')}, not in the inventory`)),
    ...p.cells.filter(c => c.state === 'partial' && !c.decision).map(c => `${name(c.capability, c.role)} is partial: decide it with map decide`),
    ...p.cells.filter(c => c.decision?.state === 'outdated').map(c => `${name(c.capability, c.role)}: decision outdated, the cell changed${c.decision?.expired ? ' (until has passed)' : ''}`),
    ...missingTerms(dir, [
      ...p.vocabulary.areas.flatMap(a => a.term ?? []),
      ...p.vocabulary.capabilities.flatMap(v => p.caps.find(c => c.id === ('extends' in v ? v.extends : v.id))?.term ?? []),
    ]),
    ...[...p.runtime.scoped, ...(p.vocabulary.scoped ?? [])]
      .filter(s => !p.caps.some(c => c.id === s.capability) || !p.roles.some(r => r.id === s.role))
      .map(s => `scoped ${s.capability} for ${s.role} at ${s.at}: no such capability or role on the map`),
    // With no Map Runtime nothing reads the grants, so a group holding none is not a problem; nor is one a roles check names.
    ...p.roles
      .filter(r => r.kind === 'group' && !p.note && !Object.values(p.runtime.grants).some(g => g.some(x => x.role === r.id)))
      .filter(r => !p.endpoints.some(e => e.who.kind === 'groups' && e.who.roles?.includes(r.id)))
      .map(r => `role ${r.id} holds no grant`),
    ...[...new Set(Object.values(p.runtime.grants).flatMap(g => g.map(x => x.role)))].filter(id => !p.roles.some(r => r.id === id)).map(id => `grants name role ${id}, which is not a role`),
    // A relation role exists through the checks that let it through: a rule's fallback or a route check with who relations.
    ...p.roles.filter(r => r.kind === 'relation' && !p.endpoints.some(e => e.who.kind === 'relations' && e.who.roles?.includes(r.id))).map(r => `role ${r.id} is a relation no check names`),
    ...[...new Set(p.endpoints.flatMap(e => (e.who.kind === 'relations' || e.who.kind === 'groups' ? (e.who.roles ?? []) : [])))].filter(id => !p.roles.some(r => r.id === id)).map(id => `a check names role ${id}, which is not a role`),
    ...p.vocabulary.areas.flatMap(a =>
      (a.contains ?? []).filter(c => !p.runtime.capabilities.some(x => x.area === c || x.area.startsWith(`${c}.`))).map(c => `area ${a.id} contains ${c}, which matches no extracted area`),
    ),
  ];
  const cov = p.coverage;
  const byKey = new Map(p.endpoints.map(e => [keyText(e.key), e]));
  // By path, then method: an endpoint's methods side by side.
  const labels = (keys: Key[]) =>
    keys
      .map(k => byKey.get(keyText(k)) ?? { method: k[0], path: k[1] })
      .sort(byPath)
      .map(e => `${e.method} ${e.path}`);
  const gaps = labels(cov.areas.flatMap(a => a.gaps));
  const packages = cov.third_party.packages;
  const findings = p.cells.filter(c => c.decision?.state === 'valid' && c.decision.decision.verdict === 'finding');
  const out = [
    ...problems,
    `coverage: ${cov.covered} of ${cov.total} endpoints behind a capability`,
    ...(cov.areas.some(a => a.covered) ? [`  ${cov.areas.filter(a => a.covered).map(a => `${a.name}: ${a.covered} of ${a.total}`).join(' · ')}`] : []),
    ...(gaps.length ? [`  first-party, behind no capability: ${gaps.join(', ')}`] : []),
    ...(packages.length
      ? [`  third-party, behind no capability: ${cov.third_party.total} (${packages.map(x => `${x.name} ${x.count}`).join(', ')})${thirdParty ? '' : ' · --third-party lists them'}`]
      : []),
    ...(thirdParty ? packages.flatMap(x => labels(x.endpoints).map(e => `    ${x.name}: ${e}`)) : []),
    `  unnamed capabilities: ${cov.unnamed.join(', ') || 'none'}`,
    `  areas with no term: ${cov.untermed.join(', ') || 'none'}`,
    `open findings: ${findings.length}`,
    ...findings.map(c => `  ${c.decision?.decision.severity} ${name(c.capability, c.role)}: ${c.decision?.decision.reason}`),
    ...p.orphans.map(d => `orphaned decision on ${d.key.join(' for ')}: ${d.decision.reason}`),
  ];
  return { code: problems.length ? 1 : 0, stdout: `${out.join('\n')}\n`, problems };
};

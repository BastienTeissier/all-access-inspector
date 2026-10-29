// map check: every problem that fails CI, then coverage and open findings. The CLI prints it, the review app shows it.

import { type Options, project } from './data.ts';
import { runtimeKey } from './runtime.ts';
import { duplicates, missingTerms, staleReferences } from './vocabulary.ts';

/** Every problem that fails CI, then coverage and open findings, which never do. */
export const check = (dir: string, options: Options = {}): { code: number; stdout: string; problems: string[] } => {
  const p = project(dir, options);
  const name = (cap: string, role: string) => `${p.caps.find(c => c.id === cap)?.name ?? cap} for ${p.roles.find(r => r.id === role)?.name ?? role}`;
  const rows = new Set(p.endpoints.map(e => runtimeKey({ method: e.key[0], path: e.path, handler: e.handler })));
  const problems = [
    ...staleReferences(dir, p.vocabulary),
    ...duplicates(p.vocabulary, p.runtime),
    ...p.runtime.endpoints.filter(e => !rows.has(runtimeKey(e))).map(e => `runtime endpoint ${runtimeKey(e)} is not in the inventory, run the Map Introspect again`),
    ...p.found.flatMap(f => f.missing.map(e => `capability ${f.cap.id} names ${e.join(' ')}, not in the inventory`)),
    ...p.cells.filter(c => c.state === 'partial' && !c.decision).map(c => `${name(c.capability, c.role)} is partial: decide it with map decide`),
    ...p.cells.filter(c => c.decision?.state === 'outdated').map(c => `${name(c.capability, c.role)}: decision outdated, the cell changed${c.decision?.expired ? ' (until has passed)' : ''}`),
    ...missingTerms(dir, [
      ...p.vocabulary.areas.map(a => a.term),
      ...p.vocabulary.capabilities.flatMap(v => p.caps.find(c => c.id === ('extends' in v ? v.extends : v.id))?.term ?? []),
    ]),
    ...[...p.runtime.scoped, ...(p.vocabulary.scoped ?? [])]
      .filter(s => !p.caps.some(c => c.id === s.capability) || !p.roles.some(r => r.id === s.role))
      .map(s => `scoped ${s.capability} for ${s.role} at ${s.at}: no such capability or role on the map`),
    // With no Map Runtime nothing reads the grants, so a group holding none is not a problem.
    ...p.roles.filter(r => r.kind === 'group' && !p.note && !Object.values(p.runtime.grants).some(g => g.some(x => x.role === r.id))).map(r => `role ${r.id} holds no grant`),
    ...[...new Set(Object.values(p.runtime.grants).flatMap(g => g.map(x => x.role)))].filter(id => !p.roles.some(r => r.id === id)).map(id => `grants name role ${id}, which is not a role`),
  ];
  const covered = new Set(p.found.flatMap(f => f.found)).size;
  const findings = p.cells.filter(c => c.decision?.state === 'valid' && c.decision.decision.verdict === 'finding');
  const out = [
    ...problems,
    `coverage: ${covered} of ${p.endpoints.length} endpoints behind a capability`,
    `open findings: ${findings.length}`,
    ...findings.map(c => `  ${c.decision?.decision.severity} ${name(c.capability, c.role)}: ${c.decision?.decision.reason}`),
    ...p.orphans.map(d => `orphaned decision on ${d.key.join(' for ')}: ${d.decision.reason}`),
  ];
  return { code: problems.length ? 1 : 0, stdout: `${out.join('\n')}\n`, problems };
};

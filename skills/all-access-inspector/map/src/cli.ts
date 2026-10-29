// map <build|check|pin|decide> <project>: the access map from the command line. Never writes through git.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { appendDecision } from '../../review/src/append.ts';
import { InventoryError } from '../../review/src/inventory.ts';
import { Refused } from '../../review/src/project.ts';
import { cellText } from '../../review/src/replay.ts';
import { check } from './check.ts';
import { type Options, buildData, project } from './data.ts';
import { JoinError } from './join.ts';
import { RuntimeError } from './runtime.ts';
import { VocabularyError, loadVocabulary, pin, vocabularyPath } from './vocabulary.ts';

export const PAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'page.html');

const USAGE = `usage:
  map build <project> [--out <file>] [--vocabulary <file>] [--runtime <file>]
  map check <project> [--vocabulary <file>] [--runtime <file>]
  map pin <project> [--vocabulary <file>]     (anchor every new file:line to the text of its line)
  map decide <project> <capability> <role> --verdict safe|accepted|finding --reason <text> [--severity low|medium|high] [--ticket <url>] [--until YYYY-MM-DD]
<project> is the directory holding tools/access-inspector/inventory.json and tools/access-map/vocabulary.json.
Defaults: --vocabulary tools/access-map/vocabulary.json, --runtime tools/access-map/runtime.json, --out tools/access-map/out/access-map.html.`;

const build = (dir: string, options: Options, out: string): string => {
  const data = buildData(dir, options);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, readFileSync(PAGE, 'utf8').replace('/*__DATA__*/null', JSON.stringify(data).replaceAll('</', '<\\/')));
  return `${data.method.runtime_note ? `${data.method.runtime_note}\n` : ''}${data.endpoints.length} endpoints, ${data.cells.length} cells -> ${out}\n`;
};

const decide = (dir: string, options: Options, values: Record<string, string | boolean | undefined>, capability: string, role: string): string => {
  const p = project(dir, options);
  if (!p.caps.some(c => c.id === capability)) throw new Refused(`no capability ${capability} on the map`);
  if (!p.roles.some(r => r.id === role)) throw new Refused(`no role ${role} on the map`);
  const cell = p.cells.find(c => cellText([c.capability, c.role]) === cellText([capability, role]));
  return appendDecision(dir, values, [capability, role], (cell as NonNullable<typeof cell>).seen);
};

export const main = (argv: string[]): { code: number; stdout: string; stderr: string } => {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        vocabulary: { type: 'string' },
        runtime: { type: 'string' },
        verdict: { type: 'string' },
        reason: { type: 'string' },
        severity: { type: 'string' },
        ticket: { type: 'string' },
        until: { type: 'string' },
      },
    });
    const [command, dir, ...rest] = positionals;
    if (!dir) throw new Refused(USAGE);
    const options = { vocabulary: values.vocabulary, runtime: values.runtime };
    if (command === 'build' && !rest.length)
      return { code: 0, stdout: build(dir, options, values.out ?? join(dir, 'tools', 'access-map', 'out', 'access-map.html')), stderr: '' };
    if (command === 'check' && !rest.length) return { ...check(dir, options), stderr: '' };
    if (command === 'pin' && !rest.length) {
      const path = values.vocabulary ?? vocabularyPath(dir);
      return { code: 0, stdout: `${pin(dir, path, loadVocabulary(path)).join('\n')}\n`, stderr: '' };
    }
    if (command === 'decide' && rest.length === 2) return { code: 0, stdout: decide(dir, options, values, rest[0] as string, rest[1] as string), stderr: '' };
    throw new Refused(USAGE);
  } catch (error) {
    if (
      error instanceof Refused ||
      error instanceof InventoryError ||
      error instanceof VocabularyError ||
      error instanceof RuntimeError ||
      error instanceof JoinError ||
      (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
    )
      return { code: 2, stdout: '', stderr: `${(error as Error).message}\n` };
    throw error;
  }
};

if (import.meta.main === undefined) {
  // Node strips types before 24.2 but has no import.meta.main there: say so rather than exit 0 silently.
  process.stderr.write(`map needs Node 24.2 or later, this is ${process.version}\n`);
  process.exitCode = 2;
} else if (import.meta.main) {
  const result = main(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

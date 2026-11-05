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
  map build <project> [--out <file>] [--json <file>] [--vocabulary <file>] [--runtime <file>]   (--json writes the page data as JSON; with --out too, both are written)
  map check <project> [--vocabulary <file>] [--runtime <file>] [--third-party]   (--third-party lists the third-party endpoints behind no capability)
  map pin <project> [--vocabulary <file>]     (anchor every new file:line to the text of its line)
  map decide <project> <capability> <role> --verdict safe|accepted|finding --reason <text> [--severity low|medium|high] [--ticket <url>] [--until YYYY-MM-DD]
<project> is the directory holding tools/access-inspector/inventory.json and tools/access-map/vocabulary.json.
Defaults: --vocabulary tools/access-map/vocabulary.json, --runtime tools/access-map/runtime.json, --out tools/access-map/out/access-map.html unless only --json is given.`;

const write = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const build = (dir: string, options: Options, out: string | undefined, json: string | undefined): string => {
  const data = buildData(dir, options);
  const targets: string[] = [];
  if (out) {
    write(out, readFileSync(PAGE, 'utf8').replace('/*__DATA__*/null', JSON.stringify(data).replaceAll('</', '<\\/')));
    targets.push(out);
  }
  if (json) {
    write(json, JSON.stringify(data));
    targets.push(json);
  }
  return `${data.method.runtime_note ? `${data.method.runtime_note}\n` : ''}${data.endpoints.length} endpoints, ${data.cells.length} cells -> ${targets.join(', ')}\n`;
};

const decide = (dir: string, options: Options, values: Record<string, string | boolean | undefined>, capability: string, role: string): string => {
  const p = project(dir, options);
  if (!p.caps.some(c => c.id === capability)) throw new Refused(`no capability ${capability} on the map`);
  if (!p.roles.some(r => r.id === role)) throw new Refused(`no role ${role} on the map`);
  return appendDecision(dir, values, [capability, role], p.current.get(cellText([capability, role]))!);
};

export const main = (argv: string[]): { code: number; stdout: string; stderr: string } => {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        json: { type: 'string' },
        help: { type: 'boolean' },
        vocabulary: { type: 'string' },
        runtime: { type: 'string' },
        verdict: { type: 'string' },
        reason: { type: 'string' },
        severity: { type: 'string' },
        ticket: { type: 'string' },
        until: { type: 'string' },
        'third-party': { type: 'boolean' },
      },
    });
    if (values.help) return { code: 0, stdout: `${USAGE}\n`, stderr: '' };
    const [command, dir, ...rest] = positionals;
    if (!dir) throw new Refused(USAGE);
    const options = { vocabulary: values.vocabulary, runtime: values.runtime };
    if (command === 'build' && !rest.length) {
      const out = values.out ?? (values.json ? undefined : join(dir, 'tools', 'access-map', 'out', 'access-map.html'));
      return { code: 0, stdout: build(dir, options, out, values.json), stderr: '' };
    }
    if (command === 'check' && !rest.length) return { ...check(dir, { ...options, thirdParty: values['third-party'] }), stderr: '' };
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

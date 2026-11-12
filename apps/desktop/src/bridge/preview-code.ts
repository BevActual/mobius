/**
 * The preview's Code app: one project kept in memory while the preview is open, so the editor, its tabs, quick open
 * and the tests can be tried without the Rust core. Nothing runs; the test command answers with a fixed result.
 */
const now = Date.now();
const FILES: Record<string, string> = {
  'README.md': '# Offsite planner\n\nSplits the offsite budget between teams and checks the shares add back to the total.\n\n```sh\nnpm test\n```\n',
  'package.json': '{\n  "name": "offsite-planner",\n  "version": "0.1.0",\n  "type": "commonjs",\n  "scripts": {\n    "test": "node tests/budget.test.js"\n  }\n}\n',
  'src/budget.js': [
    "// Splits a budget between teams by headcount, in whole cents.",
    "const { roundCents } = require('./money');",
    '',
    '/** Each team\'s share of `total`, by how many people it has. */',
    'function split(total, teams) {',
    '  const people = teams.reduce((sum, t) => sum + t.people, 0);',
    '  if (people === 0) return teams.map((t) => ({ ...t, share: 0 }));',
    '  return teams.map((t) => ({',
    '    ...t,',
    '    share: roundCents((total * t.people) / people),',
    '  }));',
    '}',
    '',
    'function summary(shares) {',
    "  return shares.map((s) => `${s.name}: ${s.share.toFixed(2)}`).join('\\n');",
    '}',
    '',
    'module.exports = { split, summary };',
    '',
  ].join('\n'),
  'src/money.js': "/** Rounds to whole cents. */\nfunction roundCents(n) {\n  return Math.round(n * 100) / 100;\n}\n\nmodule.exports = { roundCents };\n",
  'src/teams.json': '[\n  { "name": "Design", "people": 4 },\n  { "name": "Build", "people": 9 },\n  { "name": "Sales", "people": 3 }\n]\n',
  'tests/budget.test.js': "const assert = require('assert');\nconst { split } = require('../src/budget');\n\nconst shares = split(5420.03, [{ name: 'A', people: 1 }, { name: 'B', people: 2 }]);\nconst back = shares.reduce((s, t) => s + t.share, 0);\nassert.strictEqual(back, 5420.03, `shares always add back to the total, got ${back}`);\nconsole.log('✓ shares add back to the total');\n",
};
const modified: Record<string, number> = Object.fromEntries(Object.keys(FILES).map((p, i) => [p, now - i * 60_000]));
let testCommand: string | null = 'npm test';

const entries = () => {
  const folders = new Set<string>();
  Object.keys(FILES).forEach((p) => p.split('/').slice(0, -1).forEach((_, i, parts) => folders.add(parts.slice(0, i + 1).join('/'))));
  const all = [...[...folders].map((path) => ({ path, folder: true })), ...Object.keys(FILES).map((path) => ({ path, folder: false }))];
  // Folders first at each level, then names in order, as the core lists them.
  const key = (e: { path: string; folder: boolean }) => e.path.split('/').map((part, i, parts) => `${i < parts.length - 1 || e.folder ? '0' : '1'}${part}`).join('/');
  return all.sort((a, b) => key(a).localeCompare(key(b))).map((e) => ({ ...e, depth: e.path.split('/').length - 1 }));
};
const fail = (message: string) => ({ ok: false, message });

export const PREVIEW_CODE: Record<string, (...args: never[]) => unknown> = {
  'code.projects': () => [{ name: 'offsite-planner', modified: now }],
  'code.tree': ((project: string) => ({ project, entries: entries(), truncated: false })) as never,
  'code.read': ((project: string, path: string) => (path in FILES ? { project, path, text: FILES[path], modified: modified[path] } : fail('That file is not there.'))) as never,
  'code.save': ((project: string, path: string, text: string) => { FILES[path] = text; modified[path] = Date.now(); return { project, path, modified: modified[path] }; }) as never,
  'code.createFile': ((project: string, path: string) => { FILES[path] = ''; modified[path] = Date.now(); return { project, path, modified: modified[path] }; }) as never,
  'code.removeFile': ((project: string, path: string) => { delete FILES[path]; return { project, path }; }) as never,
  'code.testCommand': () => ({ command: testCommand, suggested: 'npm test' }),
  'code.setTestCommand': ((_project: string, command: string) => { testCommand = command; return { ok: true }; }) as never,
  'code.runTests': () => ({ ok: true, passed: false, code: 1, seconds: 0.4, timedOut: false, output: '> offsite-planner@0.1.0 test\n> node tests/budget.test.js\n\n✕ shares always add back to the total, got 5420.030000000001\n' }),
  'code.runCommand': ((_project: string, command: string) => ({ ok: true, passed: true, code: 0, seconds: 0.1, timedOut: false, output: `(the preview does not run ${command})` })) as never,
  'code.processes': () => [],
  'code.git': () => ({ repo: true, branch: 'main', changes: [{ status: 'M', path: 'src/budget.js' }, { status: '??', path: 'src/teams.json' }], ahead: 1 }),
};

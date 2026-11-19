#!/usr/bin/env node
// The run summary for one e2e shard, from Playwright's JSON report: which tests failed, and which only passed on their
// second try. A test that needed its second try is an unstable test, and each one is a sighting for the table in
// docs/developers/testing.md.
//   node scripts/e2e-summary.mjs <report.json> [shard]
import fs from 'node:fs';

const [file, shard] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/e2e-summary.mjs <report.json> [shard]'); process.exit(2); }
let report;
try {
  report = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  console.log(`### e2e shard ${shard ?? ''}\n\nNo report: the suite stopped before it finished.`);
  process.exit(0);
}

const failed = [];
const unstable = [];
// What axe found in e2e/a11y.spec.ts, kept with its test as annotations (its last try's).
let a11y = [];
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const name = `\`${spec.file}:${spec.line}\` ${spec.title}`;
      const firstError = test.results?.find((r) => r.status !== 'passed')?.error?.message?.split('\n')[0]?.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 160) ?? '';
      if (test.status === 'unexpected') failed.push([name, firstError]);
      if (test.status === 'flaky') unstable.push([name, firstError]);
      const found = (test.results?.at(-1)?.annotations ?? test.annotations ?? []).filter((a) => a.type === 'a11y');
      if (found.length > 0) a11y = found.map((a) => JSON.parse(a.description));
    }
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites ?? []) walk(suite);

const lines = [`### e2e shard ${shard ?? ''}`, ''];
if (failed.length === 0 && unstable.length === 0) lines.push('Every test passed on its first try.');
const list = (title, rows) => {
  if (rows.length === 0) return;
  lines.push(`**${title}**`, '', '| Test | First error |', '| --- | --- |');
  for (const [name, error] of rows) lines.push(`| ${name} | ${error.replace(/\|/g, '\\|')} |`);
  lines.push('');
};
list('Failed on both tries', failed);
list('Passed only on the second try: add a sighting to the unstable table', unstable);
if (a11y.length > 0) {
  lines.push('**Accessibility** (axe; known findings in apps/desktop/e2e/a11y-baseline.json; see docs/developers/accessibility.md)', '', '| Where | Finding | Elements | Known | Example |', '| --- | --- | ---: | ---: | --- |');
  for (const { place, key, nodes, known, help, example } of a11y) {
    lines.push(`| ${place} | ${key}: ${help.replace(/\|/g, '\\|')} | ${nodes > known ? `**${nodes}**` : nodes} | ${known} | \`${example.replace(/\|/g, '\\|').replace(/`/g, "'")}\` |`);
  }
  lines.push('');
}
console.log(lines.join('\n'));

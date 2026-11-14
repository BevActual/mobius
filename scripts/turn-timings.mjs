#!/usr/bin/env node
// Where a turn's time went, from the turn-timings.jsonl that Mobius keeps in its data folder.
//   node scripts/turn-timings.mjs <data folder or file> [how many of the latest turns, default 2]
// Each line is one step, from the message being sent: each model round (Claude Code's start-up, first word, end,
// tokens, tools offered), each event the window saw (a tool call, an approval, a result), and each tool the app ran.
import fs from 'node:fs';
import path from 'node:path';

const where = process.argv[2];
if (!where) { console.error('usage: node scripts/turn-timings.mjs <data folder or turn-timings.jsonl> [turns]'); process.exit(2); }
const file = fs.statSync(where).isDirectory() ? path.join(where, 'turn-timings.jsonl') : where;
const steps = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sent = steps.map((s, i) => [s, i]).filter(([s]) => s.step === 'sent');
const wanted = Number(process.argv[3] ?? 2);
for (const [start, at] of sent.slice(-wanted)) {
  const next = sent.find(([, i]) => i > at)?.[1] ?? steps.length;
  const turn = steps.slice(at, next).filter((s) => !s.conversation || s.conversation === start.conversation);
  const t = (s) => `${String(((s.at - start.at) / 1000).toFixed(1)).padStart(6)} s`;
  console.log(`\n${start.conversation}, sent ${new Date(start.at).toLocaleTimeString()}`);
  let rounds = 0;
  const totals = { startup: 0, model: 0, tools: 0 };
  for (const s of turn.slice(1)) {
    if (s.step === 'model') {
      rounds += 1;
      totals.startup += s.startup_ms ?? 0;
      totals.model += s.ms ?? 0;
      console.log(`${t(s)}  model round ${rounds}: ${s.ms} ms (start-up ${s.startup_ms ?? '-'} ms, first word ${s.first_text_ms ?? '-'} ms), ${s.input} in (${s.cached} cached), ${s.output} out, ${s.tools_offered} tools offered, ${s.tool_calls} called${s.ok ? '' : ', FAILED'}`);
    } else if (s.step === 'tool') {
      totals.tools += s.ms ?? 0;
      console.log(`${t(s)}    tool ${s.name}: ${s.ms} ms${s.ok ? '' : ', failed'}`);
    } else if (s.step === 'event') {
      console.log(`${t(s)}    ${s.kind}${s.name ? ` ${s.name}` : ''}`);
    }
  }
  const end = turn.at(-1);
  console.log(`total ${((end.at - start.at) / 1000).toFixed(1)} s: ${rounds} model rounds ${(totals.model / 1000).toFixed(1)} s (of which start-up ${(totals.startup / 1000).toFixed(1)} s), app tools ${(totals.tools / 1000).toFixed(1)} s, the rest approvals and the window`);
}

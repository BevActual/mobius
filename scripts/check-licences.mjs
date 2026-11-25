#!/usr/bin/env node
// Fails the build when code under a copyleft licence (GPL, LGPL, AGPL, SSPL) or a product Mobius must never bundle
// (Synapse, Element's apps, Element Call: all AGPL) enters it. Mobius is MIT and embeds only permissive code
// (docs/reference/licences.md). Talking to such software over the network is fine; shipping it is not.
//
// It reads what the build would ship: every Rust crate `cargo metadata` resolves (all targets), and every npm package
// the lockfile installs outside dev dependencies. A package passes when its SPDX expression can be satisfied without a
// copyleft licence (`MIT OR LGPL-2.1` passes, `MIT AND GPL-3.0` does not).
//
//   node scripts/check-licences.mjs            check both
//   node scripts/check-licences.mjs --npm      npm only (no cargo needed)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const COPYLEFT = /^(A?GPL|LGPL|SSPL|EUPL|OSL|CPAL|RPL)\b/i;
/** Never bundled, whatever a manifest says. Matched against the whole name. */
const NEVER = [/^(matrix-)?synapse$/i, /(^|\/)element-(web|desktop|call)/i, /^@element-hq\/element-/i, /^@vector-im\/element-/i];

/** Whether an SPDX expression can be met without copyleft: a tiny parser for OR, AND, WITH and parentheses. */
export function permissive(expr) {
  // Old crates write `MIT/Apache-2.0` for OR.
  const tokens = String(expr).replace(/\//g, ' OR ').match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const atom = () => {
    const t = tokens[i++];
    if (t === '(') { const v = or(); i++; return v; }
    let ok = !COPYLEFT.test(t ?? '');
    if (tokens[i]?.toUpperCase() === 'WITH') { i += 2; }
    return ok;
  };
  const and = () => { let v = atom(); while (tokens[i]?.toUpperCase() === 'AND') { i++; v = atom() && v; } return v; };
  const or = () => { let v = and(); while (tokens[i]?.toUpperCase() === 'OR') { i++; v = and() || v; } return v; };
  return tokens.length > 0 && or();
}

function check(kind, packages) {
  const bad = [];
  for (const { name, version, license } of packages) {
    if (NEVER.some((re) => re.test(name))) bad.push(`${kind} ${name}@${version}: never bundled (AGPL product)`);
    else if (!license) bad.push(`${kind} ${name}@${version}: no licence given`);
    else if (!permissive(license)) bad.push(`${kind} ${name}@${version}: ${license}`);
  }
  return bad;
}

/** The main workspace, and mobius-voice, which is its own (Mobius downloads it, so it ships too). */
const WORKSPACES = ['.', 'crates/mobius-voice'];

function crates() {
  return WORKSPACES.flatMap((dir) => {
    const out = execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], { cwd: new URL(`../${dir}/`, import.meta.url), maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
    return JSON.parse(out).packages.filter((p) => p.source !== null).map((p) => ({ name: p.name, version: p.version, license: p.license }));
  });
}

function npm() {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  return Object.entries(lock.packages ?? {})
    .filter(([path, p]) => path.includes('node_modules/') && !p.dev && !p.link)
    .map(([path, p]) => ({ name: path.slice(path.lastIndexOf('node_modules/') + 13), version: p.version, license: p.license }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const npmOnly = process.argv.includes('--npm');
  const bad = [...check('npm', npm()), ...(npmOnly ? [] : check('crate', crates()))];
  if (bad.length) {
    console.error(`Licence check failed: ${bad.length} package(s) Mobius can't ship.\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Licence check: every shipped crate and npm package is permissive.');
}

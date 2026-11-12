// Fails when packages/shared/src/generated is out of date with the Rust types.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './gen-types.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const committed = path.join(root, 'packages/shared/src/generated');
const text = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-types-'));
try {
  generate(fresh);
  const a = fs.readdirSync(committed).sort();
  const b = fs.readdirSync(fresh).sort();
  const problems = [];
  for (const name of new Set([...a, ...b])) {
    if (!a.includes(name)) problems.push(`missing from the repo: ${name}`);
    else if (!b.includes(name)) problems.push(`no longer generated: ${name}`);
    // Line endings do not count: a Windows checkout has CRLF where the generator writes LF.
    else if (text(path.join(committed, name)) !== text(path.join(fresh, name))) problems.push(`out of date: ${name}`);
  }
  if (problems.length) {
    console.error('Generated types are stale. Run: npm run gen:types\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('generated types are up to date');
} finally {
  fs.rmSync(fresh, { recursive: true, force: true });
}

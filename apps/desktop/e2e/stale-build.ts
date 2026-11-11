import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Before any test: the shell carries the interface inside it, built in when `cargo build` runs. An interface built
 * after the shell is not what the tests would drive, so a run then would test yesterday's screens and pass or fail
 * for the wrong reasons. Stop with what to run instead.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

function newest(dir: string): number {
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(full) : fs.statSync(full).mtimeMs);
  }
  return latest;
}

export default function checkBuild(): void {
  const dist = path.resolve(here, '../dist/tauri');
  const exe = path.resolve(here, '../../../target/debug', process.platform === 'win32' ? 'mobius-shell.exe' : 'mobius-shell');
  if (!fs.existsSync(exe)) throw new Error(`No shell at ${exe}. Run: npm run build -w @mobius/desktop, then cargo build --workspace --bins`);
  if (!fs.existsSync(dist)) throw new Error('No interface built. Run: npm run build -w @mobius/desktop, then cargo build --workspace --bins');
  const built = newest(dist);
  const shell = fs.statSync(exe).mtimeMs;
  // A second of slack for file systems that keep coarse times.
  if (built > shell + 1000) {
    throw new Error('The interface was built after the shell, so the shell still carries the old one. Run cargo build --workspace --bins (after npm run build), then the tests again. Set MOBIUS_E2E_ANY_BUILD=1 to run anyway.');
  }
}

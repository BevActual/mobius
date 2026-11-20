// Builds the Mobius installer: the interface, the core and mobius-inert-mcp, and the shell with both beside it, then
// Tauri's bundler.
//
//   npm run package                  the installer for this computer (on Windows: NSIS, per-user)
//   npm run package -- --version 0.2.0   the same, as that version (the release workflow passes the tag's)
//   npm run package -- --stage build     the programs only (the shell, the core, mobius-inert-mcp), not the installer
//   npm run package -- --stage bundle    the installer, from programs already built
//
// The release workflow builds in two stages so it can sign the core and mobius-inert-mcp between them; the bundler
// signs the shell itself (MOBIUS_SIGN_WINDOWS, below), and the installer is signed after.
//
// The updater only accepts what is signed with the key whose public half is in crates/mobius-shell/tauri.conf.json:
// set TAURI_SIGNING_PRIVATE_KEY (the key itself, or the path to its file) and TAURI_SIGNING_PRIVATE_KEY_PASSWORD
// (empty if it has none). Without it the installer is still built, but not the files the updater reads.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shell = path.join(root, 'crates', 'mobius-shell');
const args = process.argv.slice(2);
const versionAt = args.indexOf('--version');
const version = versionAt >= 0 ? args[versionAt + 1] : undefined;
if (version !== undefined && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Not a version: ${version}`);
const stageAt = args.indexOf('--stage');
const stage = stageAt >= 0 ? args[stageAt + 1] : 'all';
if (!['all', 'build', 'bundle'].includes(stage)) throw new Error(`Not a stage: ${stage} (build, bundle, or leave it out for both)`);

const run = (cmd, cmdArgs, cwd = root, env = process.env) => execFileSync(cmd, cmdArgs, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });

// The target the core is built for: the bundler looks for the core under this name and installs it as mobius-cored.
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1]?.trim();
if (!host) throw new Error('rustc did not say which target it builds for.');
const exe = process.platform === 'win32' ? '.exe' : '';

if (stage !== 'bundle') {
  console.log('› the interface');
  run('npm', ['run', 'build', '-w', '@mobius/desktop']);
  console.log('› the core, and the inert tool server the Claude Code and Copilot connections start beside it');
  run('cargo', ['build', '--release', '-p', 'mobius-cored', '--bin', 'mobius-cored', '-p', 'mobius-claude', '--bin', 'mobius-inert-mcp']);
  fs.mkdirSync(path.join(shell, 'binaries'), { recursive: true });
  // Each goes in under the name the bundler looks for; it installs them beside the shell without the target.
  for (const bin of ['mobius-cored', 'mobius-inert-mcp']) {
    fs.copyFileSync(path.join(root, 'target', 'release', `${bin}${exe}`), path.join(shell, 'binaries', `${bin}-${host}${exe}`));
  }
}

console.log(stage === 'build' ? '› the shell' : stage === 'bundle' ? '› the installer' : '› the shell and the installer');
// What changes for this build (its version; no updater files without a key), as a file: a command line on Windows
// does not keep JSON's quotes.
const env = { ...process.env };
const overrides = {};
if (version) overrides.version = version;
// Signing for the updater: without a key, build the installer alone and say so.
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  console.warn('! TAURI_SIGNING_PRIVATE_KEY is not set: the installer is built, but not the signed files the updater reads.');
  overrides.bundle = { createUpdaterArtifacts: false };
}
// Windows code signing (the release workflow sets MOBIUS_SIGN_WINDOWS=1): Tauri's bundler signs the shell after it has
// written the bundle type into it, then the programs beside it and the installer, through scripts/sign-windows.ps1.
// Signed any earlier, the shell no longer matches its signature once installed.
if (env.MOBIUS_SIGN_WINDOWS === '1') {
  const script = path.join(root, 'scripts', 'sign-windows.ps1');
  overrides.bundle = { ...overrides.bundle, windows: { signCommand: { cmd: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-File', script, '%1'] } } };
}
const overridesFile = path.join(root, 'target', 'package-overrides.json');
fs.mkdirSync(path.dirname(overridesFile), { recursive: true });
fs.writeFileSync(overridesFile, JSON.stringify(overrides));
const configs = ['--config', path.join(shell, 'tauri.release.conf.json'), '--config', overridesFile];
const bundles = process.platform === 'win32' ? ['--bundles', 'nsis'] : process.platform === 'darwin' ? ['--bundles', 'app,dmg'] : ['--bundles', 'appimage,deb'];
if (stage === 'all') run('npx', ['tauri', 'build', ...configs, ...bundles], shell, env);
// The shell's program alone; the core and mobius-inert-mcp are already in binaries/, where the bundler takes them from.
if (stage === 'build') run('npx', ['tauri', 'build', '--no-bundle', ...configs], shell, env);
if (stage === 'bundle') run('npx', ['tauri', 'bundle', ...configs, ...bundles], shell, env);

const out = path.join(root, 'target', 'release', 'bundle');
console.log(`› done: ${out}`);

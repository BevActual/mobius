// Builds everything and opens the real Mobius window, for trying out changes by hand.
//   npm run app            Chromium engine when it can be built (needs CMake and Ninja), otherwise the system web view
//   npm run app -- --fast  skip the build steps that have not changed: just the interface and the shell
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '../..');
const windows = process.platform === 'win32';

// Visual Studio Build Tools carry CMake and Ninja, which Chromium (CEF) needs to build.
const toolPaths = [];
if (windows) {
  for (const base of ['C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools', 'C:/Program Files/Microsoft Visual Studio/2022/Community']) {
    const ext = `${base}/Common7/IDE/CommonExtensions/Microsoft/CMake`;
    if (fs.existsSync(`${ext}/CMake/bin/cmake.exe`) && fs.existsSync(`${ext}/Ninja/ninja.exe`)) toolPaths.push(`${ext}/CMake/bin`, `${ext}/Ninja`);
  }
}
const cargoBin = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.cargo', 'bin');
const env = { ...process.env, PATH: [cargoBin, ...toolPaths, process.env.PATH].join(path.delimiter) };
delete env.MOBIUS_TEST;
delete env.MOBIUS_HIDE_WINDOW;

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', shell: windows });
  if (result.status !== 0) {
    console.error(`\n"${command} ${args.join(' ')}" failed.`);
    process.exit(result.status ?? 1);
  }
};

console.log('Building the interface…');
run('npx', ['vite', 'build', '--mode', 'tauri'], desktop);

const withChromium = toolPaths.length > 0 && !process.argv.includes('--webview');
console.log(withChromium ? 'Building the shell with Chromium…' : 'Building the shell (system web view; Chromium needs CMake and Ninja)…');
run('cargo', ['build', '-p', 'mobius-cored', '-p', 'mobius-shell', ...(withChromium ? ['--features', 'cef'] : [])], root);

const exe = path.join(root, 'target', 'debug', windows ? 'mobius-shell.exe' : 'mobius-shell');
console.log('Opening Mobius.');
const child = spawn(exe, [], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));

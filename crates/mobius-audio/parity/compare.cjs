// Renders a song with the window's code (in headless Chromium) and with the engine, whole and track by track, and
// says how far apart they are: overall level, and the level every 100 ms.
//
//   node crates/mobius-audio/parity/compare.cjs demo/workspace/studio/Songs/Demo.json
//
// Noise differs between the two (drums, reverb rooms), so those tracks stay about a dB apart window to window;
// everything else should agree to a tenth of a dB.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repo = path.resolve(__dirname, '../../..');
const songPath = process.argv[2];
if (!songPath) throw new Error('usage: node compare.cjs <song.json>');
const text = fs.readFileSync(songPath, 'utf8');
const song = JSON.parse(text);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mobius-parity-'));
execFileSync(path.join(repo, 'node_modules/.bin/esbuild'), [path.join(__dirname, 'window.ts'), '--bundle', '--format=iife', `--outfile=${work}/window.js`, '--log-level=warning']);
execFileSync('cargo', ['build', '-q', '-p', 'mobius-audio', '--example', 'render'], { cwd: repo, stdio: 'inherit' });

const readWav = (file) => {
  const b = fs.readFileSync(file);
  const data = new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
  const n = data.length / 2;
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = data[2 * i]; r[i] = data[2 * i + 1]; }
  return [l, r];
};
const decode = (s) => { const bin = Buffer.from(s, 'base64'); return new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length)); };
const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

(async () => {
  // CHROMIUM_PATH picks a browser when the repo's Playwright has none of its own installed.
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.addScriptTag({ path: `${work}/window.js` });
  for (const id of [null, ...song.tracks.map((t) => t.id)]) {
    const [wl, wr] = (await page.evaluate(([t, s]) => window.renderInWindow(t, s), [text, id ?? undefined])).map(decode);
    const solo = JSON.parse(text);
    if (id) for (const t of solo.tracks) t.muted = t.id !== id;
    fs.writeFileSync(`${work}/song.json`, JSON.stringify(solo));
    execFileSync('cargo', ['run', '-q', '-p', 'mobius-audio', '--example', 'render', '--', `${work}/song.json`, `${work}/engine.wav`], { cwd: repo });
    const [el, er] = readWav(`${work}/engine.wav`);
    const n = Math.min(wl.length, el.length), step = 4410;
    let worst = 0, sum = 0, count = 0;
    for (let i = 0; i + step <= n; i += step) {
      const a = rms(wl, i, i + step) + rms(wr, i, i + step), b = rms(el, i, i + step) + rms(er, i, i + step);
      if (a < 1e-4 && b < 1e-4) continue;
      const d = Math.abs(db(a) - db(b)); worst = Math.max(worst, d); sum += d; count++;
    }
    const t = song.tracks.find((x) => x.id === id);
    const name = t ? `${t.name ?? t.id} (${t.instrument}${(t.fx ?? []).map((f) => ' + ' + f.kind).join('')})` : 'Whole song';
    console.log(`${name}\n  window ${db(rms(wl)).toFixed(1)} / ${db(rms(wr)).toFixed(1)} dB, engine ${db(rms(el)).toFixed(1)} / ${db(rms(er)).toFixed(1)} dB; every 100 ms off by ${(sum / Math.max(1, count)).toFixed(2)} dB on average, ${worst.toFixed(1)} at most`);
  }
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
})();

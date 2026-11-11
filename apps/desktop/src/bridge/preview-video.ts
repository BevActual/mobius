/**
 * The preview's Video app: one project of short clips, recorded from a canvas when first played, and a cut kept in
 * memory. The window's player reads clips from the shell's media address, which the preview has not got, so a player
 * given one of those addresses is pointed at the recorded clip instead.
 */
type Clip = { name: string; seconds: number; sky: [string, string]; ground: string; label: string };
const PROJECT = 'Kestrel P2 launch';
const CLIPS: Clip[] = [
  { name: 'Workshop walkaround.webm', seconds: 4, sky: ['#30343b', '#5b616b'], ground: '#1d2024', label: 'Workshop' },
  { name: 'Track run.webm', seconds: 5, sky: ['#7fa7cf', '#d5e4f1'], ground: '#3a3f46', label: 'Test track' },
  { name: 'Driver interview.webm', seconds: 3, sky: ['#3b2a63', '#f09a5b'], ground: '#24161f', label: 'Interview' },
];
let CUT = '{\n  "version": 1,\n  "shots": [\n    {"id":"s1","clip":"Workshop walkaround.webm","in":0,"out":3,"title":"Kestrel P2"},\n    {"id":"s2","clip":"Track run.webm","in":0.5,"out":4.5},\n    {"id":"s3","clip":"Driver interview.webm","in":0,"out":2.5,"title":"“It just goes.”"}\n  ]\n}\n';
let MODIFIED = Date.now() - 86_400_000;

const recorded = new Map<string, Promise<string>>();
function record(clip: Clip): Promise<string> {
  let got = recorded.get(clip.name);
  if (got) return got;
  got = new Promise<string>((resolve) => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d')!;
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    rec.onstop = () => resolve(URL.createObjectURL(new Blob(parts, { type: 'video/webm' })));
    const start = performance.now();
    const draw = () => {
      const t = (performance.now() - start) / 1000;
      const sky = g.createLinearGradient(0, 0, 0, 240);
      sky.addColorStop(0, clip.sky[0]); sky.addColorStop(1, clip.sky[1]);
      g.fillStyle = sky; g.fillRect(0, 0, 640, 360);
      g.fillStyle = clip.ground; g.fillRect(0, 240, 640, 120);
      const x = ((t / clip.seconds) * 760) - 80;
      g.fillStyle = '#5b5bd6'; g.beginPath(); g.roundRect(x, 200, 120, 44, 14); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(x + 28, 246, 13, 0, Math.PI * 2); g.arc(x + 92, 246, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '600 22px system-ui'; g.fillText(`${clip.label} · ${t.toFixed(1)} s`, 24, 40);
      if (t < clip.seconds) requestAnimationFrame(draw); else rec.stop();
    };
    rec.start();
    draw();
  });
  recorded.set(clip.name, got);
  return got;
}

const MEDIA = /^(?:http:\/\/media\.localhost|media:\/\/localhost)\/([^/]+)\/([^/?#]+)/;
let patched = false;
function patchPlayers(): void {
  if (patched || typeof HTMLMediaElement === 'undefined') return;
  patched = true;
  const point = (el: HTMLMediaElement, value: string, set: (v: string) => void): boolean => {
    const m = MEDIA.exec(value);
    const clip = m && CLIPS.find((c) => c.name === decodeURIComponent(m[2]!));
    if (!clip) return false;
    void record(clip).then((url) => { set(url); el.dataset.previewSrc = value; });
    return true;
  };
  const setAttribute = Element.prototype.setAttribute;
  const getAttribute = Element.prototype.getAttribute;
  HTMLMediaElement.prototype.setAttribute = function (this: HTMLMediaElement, name: string, value: string) {
    if (name === 'src' && point(this, value, (v) => setAttribute.call(this, 'src', v))) { this.dataset.previewSrc = value; return; }
    setAttribute.call(this, name, value);
  };
  HTMLMediaElement.prototype.getAttribute = function (this: HTMLMediaElement, name: string) {
    if (name === 'src' && this.dataset.previewSrc) return this.dataset.previewSrc;
    return getAttribute.call(this, name);
  };
  const src = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!;
  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    ...src,
    set(this: HTMLMediaElement, value: string) { if (!point(this, value, (v) => src.set!.call(this, v))) src.set!.call(this, value); },
  });
}

export const PREVIEW_VIDEO: Record<string, (...args: never[]) => unknown> = {
  'video.projects': () => { patchPlayers(); return [{ name: PROJECT, clips: CLIPS.map((c) => ({ name: c.name, bytes: c.seconds * 200_000, kind: 'video' as const })), hasCut: true }]; },
  'video.readCut': ((project: string) => ({ project, text: CUT, modified: MODIFIED })) as never,
  'video.saveCut': ((project: string, text: string) => { CUT = text; MODIFIED = Date.now(); return { project, modified: MODIFIED }; }) as never,
};

import { cutLength, shotLength, shotStart, type Cut } from './cut-format';

/**
 * Exporting the cut as a film: the shots are played through once, in order, onto a canvas with their titles drawn
 * over them, and the canvas and the clips' sound are recorded. So an export takes as long as the film, and needs
 * nothing but the window. The clips are never changed.
 */

/**
 * The recorder formats, best first: H.264 MP4 plays everywhere (Windows' window can make it); then WebM; plain MP4
 * last, since without H.264 it can hold VP9, which some players cannot open (macOS' and Linux's windows only make MP4).
 */
const FORMATS = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
  { mime: 'video/mp4', ext: 'mp4' },
] as const;
export type ExportFormat = (typeof FORMATS)[number];

/** The first format this window's recorder can make; null when it cannot record at all. */
export function exportFormat(supported: (mime: string) => boolean): ExportFormat | null {
  return FORMATS.find((f) => { try { return supported(f.mime); } catch { return false; } }) ?? null;
}

/** The film's size: the first clip's shape, no bigger than 1920 × 1080, in even numbers (encoders want them). */
export function exportSize(width: number, height: number): { width: number; height: number } {
  if (!(width > 0 && height > 0)) return { width: 1280, height: 720 };
  const scale = Math.min(1, 1920 / width, 1080 / height);
  const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Where a picture of `w` × `h` sits in the film's frame: as large as fits, centred, the rest black. */
export function fitRect(w: number, h: number, frameW: number, frameH: number): { x: number; y: number; w: number; h: number } {
  if (!(w > 0 && h > 0)) return { x: 0, y: 0, w: frameW, h: frameH };
  const scale = Math.min(frameW / w, frameH / h);
  const dw = w * scale, dh = h * scale;
  return { x: (frameW - dw) / 2, y: (frameH - dh) / 2, w: dw, h: dh };
}

/** The film's file name: the project's, with the format's ending. */
export function exportName(project: string, format: ExportFormat): string {
  const base = project.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Film';
  return `${base}.${format.ext}`;
}

/** A title over the picture, as the viewer shows it: bold, white, centred, a little below the middle, with a soft shadow. */
function drawTitle(g: CanvasRenderingContext2D, text: string, w: number, h: number): void {
  if (!text) return;
  const size = Math.round(Math.max(18, Math.min(h * 0.075, w * 0.06)));
  g.save();
  g.font = `700 ${size}px -apple-system, "SF Pro Display", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  g.shadowColor = 'rgba(0, 0, 0, 0.6)';
  g.shadowBlur = size * 0.4;
  g.shadowOffsetY = size * 0.06;
  g.fillText(text, w / 2, h * 0.82, w * 0.9);
  g.restore();
}

const once = (el: HTMLMediaElement, ok: string, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const done = () => { el.removeEventListener(ok, done); el.removeEventListener('error', fail); signal.removeEventListener('abort', stop); resolve(); };
  const fail = () => { el.removeEventListener(ok, done); el.removeEventListener('error', fail); signal.removeEventListener('abort', stop); reject(new Error('A clip in the cut cannot be read.')); };
  const stop = () => { el.removeEventListener(ok, done); el.removeEventListener('error', fail); reject(new DOMException('Stopped', 'AbortError')); };
  el.addEventListener(ok, done);
  el.addEventListener('error', fail);
  signal.addEventListener('abort', stop, { once: true });
});

/**
 * Plays the cut through onto a canvas and records it. `source` gives each clip's playable address; `progress` hears
 * how far along the film is, from 0 to 1. Stops with an AbortError when `signal` is aborted.
 */
export async function renderCut(cut: Cut, source: (clip: string) => Promise<string>, format: ExportFormat, progress: (done: number) => void, signal: AbortSignal): Promise<Blob> {
  const total = cutLength(cut);
  if (cut.shots.length === 0 || total <= 0) throw new Error('The cut has no shots yet.');
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This window cannot draw the film.');
  const audio = new AudioContext();
  const sound = audio.createMediaStreamDestination();
  const players: HTMLVideoElement[] = [];
  const load = async (clip: string): Promise<HTMLVideoElement> => {
    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.playsInline = true;
    const ready = once(el, 'loadeddata', signal);
    el.setAttribute('src', await source(clip));
    await ready;
    audio.createMediaElementSource(el).connect(sound);
    players.push(el);
    return el;
  };
  let recorder: MediaRecorder | null = null;
  try {
    const first = await load(cut.shots[0]!.clip);
    const size = exportSize(first.videoWidth, first.videoHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    g.fillStyle = '#000';
    g.fillRect(0, 0, size.width, size.height);
    const stream = canvas.captureStream(30);
    for (const track of sound.stream.getAudioTracks()) stream.addTrack(track);
    recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
    const stopped = new Promise<void>((resolve) => { recorder!.onstop = () => resolve(); });
    // Made while the click that asked for the export still counts, so the window lets it play; never waited on for long.
    await Promise.race([audio.resume(), new Promise((r) => window.setTimeout(r, 1000))]);

    let next: Promise<HTMLVideoElement> | null = null;
    for (let i = 0; i < cut.shots.length; i++) {
      const shot = cut.shots[i]!;
      const el = i === 0 ? first : await (next ?? load(shot.clip));
      // The next shot's clip is read while this one plays, so the film does not wait between shots.
      next = i + 1 < cut.shots.length ? load(cut.shots[i + 1]!.clip) : null;
      next?.catch(() => undefined);
      const seeked = once(el, 'seeked', signal);
      el.currentTime = shot.in;
      await seeked;
      const box = fitRect(el.videoWidth, el.videoHeight, canvas.width, canvas.height);
      const draw = () => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, canvas.width, canvas.height);
        if (el.videoWidth > 0) g.drawImage(el, box.x, box.y, box.w, box.h);
        drawTitle(g, shot.title, canvas.width, canvas.height);
      };
      draw();
      if (recorder.state === 'inactive') recorder.start(1000);
      else if (recorder.state === 'paused') recorder.resume();
      // A window that will not play sound without a click plays the shot muted: the film is still made, silent.
      await el.play().catch(async (e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'NotAllowedError')) throw e;
        el.muted = true;
        await el.play();
      });
      const start = shotStart(cut, i);
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (signal.aborted) { reject(new DOMException('Stopped', 'AbortError')); return; }
          draw();
          progress(Math.min(1, (start + Math.max(0, el.currentTime - shot.in)) / total));
          if (el.currentTime >= shot.out - 0.02 || el.ended) { resolve(); return; }
          requestAnimationFrame(tick);
        };
        tick();
      });
      el.pause();
      // Nothing is recorded while the next clip finds its first frame.
      if (i + 1 < cut.shots.length) recorder.pause();
      progress(Math.min(1, (start + shotLength(shot)) / total));
    }
    recorder.stop();
    await stopped;
    return new Blob(parts, { type: format.mime.split(';')[0] });
  } finally {
    if (recorder && recorder.state !== 'inactive') { recorder.ondataavailable = null; recorder.stop(); }
    for (const el of players) { el.pause(); el.removeAttribute('src'); el.load(); }
    void audio.close().catch(() => undefined);
  }
}

/** A blob as base64, for the bridge. */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('The film could not be read.'));
    reader.readAsDataURL(blob);
  });
}

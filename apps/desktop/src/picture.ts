/** Pictures attached to a message: made small enough to send (at most 1600 px on the long side, as JPEG). */
export const MAX_PICTURES = 4;
const LONG_SIDE = 1600;

function shrink(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** A picture file (or one pasted) as a small JPEG data URL; null when it is not a picture that opens. */
export function pictureFromFile(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    if (!/^image\//.test(file.type)) { resolve(null); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(shrink(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/** A picture already shown as a data URL (the photo open in Photo), made small enough to send. */
export function pictureFromUrl(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(shrink(img, img.naturalWidth, img.naturalHeight));
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Look at this: the person chooses a window (or a screen) in the system's own picker, and one still of it is taken.
 * Nothing is recorded; the capture stops as soon as the still is taken.
 */
export async function pictureOfWindow(): Promise<{ ok: true; picture: string } | { ok: false; error: string }> {
  const media = navigator.mediaDevices as MediaDevices | undefined;
  if (!media?.getDisplayMedia) return { ok: false, error: 'Showing a window is not available here.' };
  let stream: MediaStream;
  try {
    stream = await media.getDisplayMedia({ video: true, audio: false });
  } catch {
    return { ok: false, error: 'No window was shared.' };
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!video.videoWidth) return { ok: false, error: 'That window could not be seen.' };
    return { ok: true, picture: shrink(video, video.videoWidth, video.videoHeight) };
  } catch {
    return { ok: false, error: 'That window could not be seen.' };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

import { isNotesFailure } from '@mobius/shared';
import { resolveColor, type DesignDoc, type DesignFrame, type DesignNode } from './design-format';

/** The album in Photo that a design's exported frames go to. */
export const EXPORT_ALBUM = 'Design exports';

/**
 * A frame's text broken into lines that fit `width`, as the canvas draws it: on spaces where it can, and inside a long
 * word only when the word alone is too wide. `measure` gives a run of text's width.
 */
export function wrapText(text: string, width: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (measure(next) <= width || line === '') {
        line = next;
        // One word wider than the box: broken where it runs out of room.
        while (measure(line) > width && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && measure(line.slice(0, cut)) > width) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        out.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

function shape(ctx: CanvasRenderingContext2D, n: { type?: DesignNode['type']; x: number; y: number; w: number; h: number; radius: number }, inset = 0) {
  const x = n.x + inset, y = n.y + inset, w = Math.max(0, n.w - inset * 2), h = Math.max(0, n.h - inset * 2);
  ctx.beginPath();
  if (n.type === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(x, y, w, h, Math.max(0, Math.min(n.radius - inset, w / 2, h / 2)));
}

function border(ctx: CanvasRenderingContext2D, t: { type?: DesignNode['type']; x: number; y: number; w: number; h: number; radius: number; stroke: string; strokeWidth: number }, doc: DesignDoc) {
  if (t.strokeWidth <= 0 || t.stroke === 'transparent') return;
  ctx.lineWidth = t.strokeWidth;
  ctx.strokeStyle = resolveColor(t.stroke, doc.styles);
  // Inside the edge, as on the canvas.
  shape(ctx, t, t.strokeWidth / 2);
  ctx.stroke();
}

/** Draws one frame, at `scale` times its size, as it shows on the canvas: its fill, its layers in order, and borders. */
export function drawFrame(doc: DesignDoc, frame: DesignFrame, scale: number, font: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(frame.w * scale));
  canvas.height = Math.max(1, Math.round(frame.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const box = { x: 0, y: 0, w: frame.w, h: frame.h, radius: frame.radius };
  shape(ctx, box);
  ctx.clip();
  if (frame.fill !== 'transparent') { ctx.fillStyle = resolveColor(frame.fill, doc.styles); ctx.fill(); }
  for (const n of frame.children) {
    if (n.hidden) continue;
    ctx.save();
    ctx.globalAlpha = n.opacity;
    if (n.fill !== 'transparent') { ctx.fillStyle = resolveColor(n.fill, doc.styles); shape(ctx, n); ctx.fill(); }
    if (n.type === 'text') {
      ctx.font = `${n.weight} ${n.size}px ${font}`;
      ctx.fillStyle = resolveColor(n.color, doc.styles);
      ctx.textBaseline = 'middle';
      ctx.textAlign = n.align;
      const lineHeight = n.size * 1.25;
      const x = n.align === 'center' ? n.x + n.w / 2 : n.align === 'right' ? n.x + n.w : n.x;
      shape(ctx, { ...n, radius: 0 });
      ctx.clip();
      wrapText(n.text, n.w, (s) => ctx.measureText(s).width).forEach((line, i) => ctx.fillText(line, x, n.y + lineHeight * i + lineHeight / 2));
    } else border(ctx, n, doc);
    ctx.restore();
  }
  border(ctx, { ...box, stroke: frame.stroke, strokeWidth: frame.strokeWidth }, doc);
  return canvas;
}

/** The frame as a PNG (base64, without the data: prefix). */
export function framePng(doc: DesignDoc, frame: DesignFrame, scale: number, font: string): string {
  return drawFrame(doc, frame, scale, font).toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/**
 * Saves a frame as a PNG into Photo's "Design exports" album (made the first time), and says where it went. The
 * picture is drawn here, so nothing new is needed from the core: Photo already keeps pictures.
 */
export async function exportFrame(doc: DesignDoc, frame: DesignFrame, scale = 2): Promise<{ path: string } | { error: string }> {
  const photos = window.mobius.photos;
  if (!photos) return { error: 'Exporting needs Photo, which this window does not have.' };
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const data = framePng(doc, frame, scale, font);
  const albums = await photos.albums();
  if (isNotesFailure(albums) || !Array.isArray(albums)) return { error: (isNotesFailure(albums) && albums.message) || 'Photo could not be reached, so the picture was not saved.' };
  if (!albums.some((a) => a.name === EXPORT_ALBUM)) {
    const made = await photos.createAlbum(EXPORT_ALBUM);
    if (isNotesFailure(made)) return { error: made.message || `The ${EXPORT_ALBUM} album could not be made.` };
  }
  const saved = await photos.add(EXPORT_ALBUM, `${frame.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Frame'}${scale === 1 ? '' : ` @${scale}x`}.png`, data);
  if (isNotesFailure(saved) || !saved?.path) return { error: (isNotesFailure(saved) && saved.message) || 'The picture could not be saved.' };
  return { path: saved.path };
}

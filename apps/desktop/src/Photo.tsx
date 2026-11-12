import { RowMark } from './RowMark';
import { FromMobius } from './FromMobius';
import { EmptyState } from './EmptyState';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import {
  AMOUNT_GROUPS, AMOUNT_NAMES, FILTERS, FILTER_ID, applyEdits, autoAmounts, blankAdjustment, coverScale, describePixels, editsPathFor, filterOf, histogram, isPlain, parseEdits, plainGeometry, turnedSize, withFilter,
  type Adjustment, type AreaKind, type FilterId, type Geometry, type PhotoEdits,
} from './photo-edit';
import { ASPECTS, HANDLES, aspectRatio, dragCrop, fitAspect, flippedCrop, stepTo, turnedCrop, type AspectId, type Handle } from './photo-view';
import type { PhotosState } from './usePhotos';
import { ReviewActions, WhyThis } from './ReviewBar';
import { onCommand } from './commands';
import './photo.css';

const PREVIEW_MAX = 1600;
const EXPORT_MAX = 6000;
const THUMB_MAX = 360;

const Icon = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" data-fill={fill || undefined}><path d={d} /></svg>
);
const PLUS = 'M10 4v12M4 10h12';
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable);

/** Albums down the side, as Photos lists them; the album's photos show as a grid. */
export function PhotoSidebar({ photos, pin, changed }: { photos: PhotosState; pin?: ReactNode; changed?: ReadonlySet<string> }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const made = await photos.createAlbum(name.trim() || 'Album');
    if (made) { setNaming(false); setName(''); photos.showAlbum(made); }
  };
  return (
    <aside className="side photo-side" aria-label="Photo sidebar">
      <div className="side-head">
        <span className="side-title">Albums</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New album" title="New album" onClick={() => setNaming(true)}><Icon d={PLUS} /></button>
        </span>
      </div>
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Album name" placeholder="Album name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {photos.albums.length === 0 && !naming && (
        <div className="side-empty notes-empty">
          <p>Albums are folders of pictures in your workspace. Edits are kept beside each picture, never in it.</p>
          <button type="button" className="btn primary" onClick={() => setNaming(true)}>New album</button>
        </div>
      )}
      <nav className="photo-albums" aria-label="Albums">
        <ul role="list">
          {photos.albums.map((a) => (
            <li key={a.name}>
              <button type="button" className="list-row photo-album-row" aria-current={a.name === photos.album ? 'page' : undefined} onClick={() => photos.showAlbum(a.name)}>
                <svg className="photo-album-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="4" width="15" height="12" rx="2.5" /><path d="M2.5 13l4-4 3.5 3.5 2.5-2.5 5 5" /></svg>
                <span className="list-name">{a.name}</span>
                {a.photos.some((p) => changed?.has(p.path))
                  ? <RowMark changed changedTitle="Edited by Mobius in its last turn" />
                  : <span className="photo-album-count">{a.photos.length}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <FromMobius items={photos.albums.flatMap((a) => a.photos.filter((p) => changed?.has(p.path)).map((p) => ({ key: p.path, name: p.name, where: a.name, current: photos.open?.path === p.path, onOpen: () => void photos.openPhoto(p.path) })))} />
    </aside>
  );
}

/** Draws a picture turned, flipped, straightened and cropped (unless `uncropped`), then adjusted, no bigger than `max`. */
function render(img: HTMLImageElement, max: number, edits: PhotoEdits | null, uncropped = false): HTMLCanvasElement {
  const g: Geometry = edits?.geometry ?? plainGeometry();
  const crop = uncropped ? { x: 0, y: 0, w: 1, h: 1 } : g.crop;
  const [fw, fh] = turnedSize(img.naturalWidth, img.naturalHeight, g.turns);
  const scale = Math.min(1, max / Math.max(fw * crop.w, fh * crop.h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(fw * crop.w * scale));
  c.height = Math.max(1, Math.round(fh * crop.h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  const W = fw * scale, H = fh * scale;
  ctx.translate(-crop.x * W, -crop.y * H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate((g.straighten * Math.PI) / 180);
  const s = coverScale(W, H, g.straighten);
  ctx.scale(g.flip ? -s : s, s);
  ctx.rotate((-g.turns * Math.PI) / 2);
  const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (edits && edits.adjustments.length > 0) {
    const data = ctx.getImageData(0, 0, c.width, c.height);
    applyEdits(data.data, c.width, c.height, edits);
    ctx.putImageData(data, 0, 0);
  }
  return c;
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const i = new Image();
  i.onload = () => resolve(i);
  i.onerror = () => reject(new Error('This picture could not be opened.'));
  i.src = src;
});

/** Small pictures of an album's photos with their edits, made one at a time and kept while the app is open. */
const THUMBS = new Map<string, string>();
function useThumbs(photos: PhotosState, paths: readonly { path: string; modified: number }[]) {
  const [, setStamp] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const p of paths) {
        const key = `${p.path}@${p.modified}`;
        if (THUMBS.has(key)) continue;
        const got = await photos.read(p.path)?.catch(() => null);
        if (!live) return;
        if (!got || !('dataUrl' in got)) continue;
        const img = await loadImage(got.dataUrl).catch(() => null);
        if (!img || !live) continue;
        THUMBS.set(key, render(img, THUMB_MAX, parseEdits(got.edits)).toDataURL('image/jpeg', 0.85));
        setStamp((n) => n + 1);
      }
    })();
    return () => { live = false; };
  }, [paths.map((p) => `${p.path}@${p.modified}`).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (p: { path: string; modified: number }) => THUMBS.get(`${p.path}@${p.modified}`);
}
const forgetThumb = (path: string) => { for (const k of THUMBS.keys()) if (k.startsWith(`${path}@`)) THUMBS.delete(k); };

/** The album's photos as a grid of square pictures, as Photos shows a library. */
function PhotoGrid({ photos, onDrop }: { photos: PhotosState; onDrop: (e: DragEvent) => void }) {
  const album = photos.albums.find((a) => a.name === photos.album) ?? null;
  const list = album?.photos ?? [];
  const thumb = useThumbs(photos, list);
  const grid = useRef<HTMLUListElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // The photo just left keeps the focus, so the keyboard carries on from there.
  useEffect(() => {
    const at = photos.open ? list.findIndex((p) => p.path === photos.open!.path) : -1;
    grid.current?.querySelectorAll<HTMLButtonElement>('.photo-tile')[Math.max(0, at)]?.focus({ preventScroll: false });
  }, [photos.album]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: ReactKeyboardEvent) => {
    const tiles = [...(grid.current?.querySelectorAll<HTMLButtonElement>('.photo-tile') ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const cols = Math.max(1, getComputedStyle(grid.current!).gridTemplateColumns.split(' ').length);
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'ArrowDown' ? at + cols : e.key === 'ArrowUp' ? at - cols : e.key === 'Home' ? 0 : e.key === 'End' ? tiles.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    tiles[Math.max(0, Math.min(tiles.length - 1, to))]?.focus();
  };
  if (!album) {
    return (
      <section className="photo-page empty" aria-label="Photo" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <EmptyState app="photo" title="No albums yet" line="Make an album, then drop pictures on the window to add them." action={{ label: 'New album', run: () => void photos.createAlbum('Album').then((made) => { if (made) photos.showAlbum(made); }) }} />
      </section>
    );
  }
  return (
    <section className="photo-page photo-library" aria-label="Photo" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="photo-bar" role="toolbar" aria-label="Album">
        <div className="photo-bar-title">
          <h2>{album.name}</h2>
          <span className="photo-meta">{list.length === 1 ? '1 photo' : `${list.length} photos`}</span>
        </div>
        <span className="spacer" />
        <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden aria-hidden="true" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void photos.addFiles(album.name, files); }} />
        <button type="button" className="photo-tool" onClick={() => picker.current?.click()}><Icon d={PLUS} /><span>Add photos</span></button>
      </header>
      {photos.message && <p className="tasks-message" role="alert">{photos.message}</p>}
      {list.length === 0 ? (
        <EmptyState app="photo" title={`No photos in ${album.name}`} line="Drop pictures on the window to add them." action={{ label: 'Add photos', run: () => picker.current?.click() }} />
      ) : (
        <ul ref={grid} className="photo-grid" role="list" aria-label={`Photos in ${album.name}`} onKeyDown={onKey}>
          {list.map((p) => {
            const src = thumb(p);
            return (
              <li key={p.path}>
                <button type="button" className="photo-tile" aria-label={p.name} aria-current={photos.open?.path === p.path ? 'true' : undefined} title={p.name} onClick={() => void photos.openPhoto(p.path)}>
                  {src ? <img src={src} alt="" draggable={false} /> : <span className="photo-tile-wait" />}
                  {p.edited && <span className="photo-tile-badge glass-clear" title="Edited"><Icon d="M4 10.5l3.5 3.5L16 5.5" /></span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Slider({ label, value, min = -100, max = 100, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
  const zero = min < 0 ? 0 : Math.round((min + max) / 2);
  const fill = ((value - min) / (max - min)) * 100, from = ((zero - min) / (max - min)) * 100;
  return (
    <label className="photo-slider" data-changed={value !== zero || undefined}>
      <span className="photo-slider-head"><span>{label}</span><output>{value}</output></span>
      <input
        type="range" aria-label={label} min={min} max={max} step={step} value={value}
        style={{ ['--from' as string]: `${Math.min(fill, from)}%`, ['--to' as string]: `${Math.max(fill, from)}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(zero)}
      />
    </label>
  );
}

const AREA_NAMES: Record<AreaKind, string> = { all: 'All of the photo', below: 'Below a line', above: 'Above a line', ellipse: 'Inside an ellipse' };
type Tab = 'adjust' | 'filters' | 'crop';
const TABS: readonly { id: Tab; name: string }[] = [{ id: 'adjust', name: 'Adjust' }, { id: 'filters', name: 'Filters' }, { id: 'crop', name: 'Crop' }];

/** The open photo: the album's grid, or one photo with Adjust, Filters and Crop beside it, and Mobius's change to keep. */
export function PhotoEditor({ photos, review }: { photos: PhotosState; review?: { conversation: string } | null }) {
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type));
    const album = photos.album ?? photos.albums[0]?.name;
    if (files.length && album) void photos.addFiles(album, files);
  };
  if (!photos.available) return <section className="photo-page empty" aria-label="Photo"><EmptyState app="photo" title="Photo is not available here" /></section>;
  if (photos.browsing || !photos.open) return <PhotoGrid photos={photos} onDrop={onDrop} />;
  return <PhotoView photos={photos} review={review} onDrop={onDrop} />;
}

function PhotoView({ photos, review, onDrop }: { photos: PhotosState; review?: { conversation: string } | null; onDrop: (e: DragEvent) => void }) {
  const shown = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [before, setBefore] = useState(false);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<Tab>('adjust');
  const [aspect, setAspect] = useState<AspectId>('free');
  const [zoomed, setZoomed] = useState(false);
  const [bins, setBins] = useState<number[]>([]);
  const [tiles, setTiles] = useState<Partial<Record<FilterId | 'original', string>>>({});
  const { open, edits } = photos;
  const geometry = edits.geometry ?? plainGeometry();
  const cropping = tab === 'crop';

  // The picture, read once per photo.
  useEffect(() => {
    if (!open) { setImg(null); return; }
    let live = true;
    setZoomed(false);
    loadImage(open.dataUrl).then((i) => {
      if (!live) return;
      setImg(i);
      const small = render(i, 400, null);
      const ctx = small.getContext('2d')!;
      photos.setDescribed(describePixels(ctx.getImageData(0, 0, small.width, small.height).data, i.naturalWidth, i.naturalHeight).replace(/^\d+ × \d+/, `${i.naturalWidth} × ${i.naturalHeight}`));
    }, (e: Error) => photos.setMessage(e.message));
    return () => { live = false; };
  }, [open?.dataUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redrawn as the edits change, at most once a frame; while cropping, the whole picture shows with the box over it.
  useEffect(() => {
    if (!img || !shown.current) return;
    const id = requestAnimationFrame(() => {
      const c = render(img, PREVIEW_MAX, before ? null : edits, cropping);
      const target = shown.current;
      if (!target) return;
      target.width = c.width;
      target.height = c.height;
      target.getContext('2d')!.drawImage(c, 0, 0);
      if (!cropping) {
        const small = document.createElement('canvas');
        const k = Math.min(1, 200 / Math.max(c.width, c.height));
        small.width = Math.max(1, Math.round(c.width * k)); small.height = Math.max(1, Math.round(c.height * k));
        const sctx = small.getContext('2d', { willReadFrequently: true })!;
        sctx.drawImage(c, 0, 0, small.width, small.height);
        setBins(histogram(sctx.getImageData(0, 0, small.width, small.height).data));
      }
    });
    return () => cancelAnimationFrame(id);
  }, [img, edits, before, cropping]);

  // The filters, each shown on a small copy of the photo as it is now.
  useEffect(() => {
    if (tab !== 'filters' || !img) return;
    const id = window.setTimeout(() => {
      const out: Partial<Record<FilterId | 'original', string>> = { original: render(img, 150, withFilter(edits, null)).toDataURL('image/jpeg', 0.8) };
      for (const f of FILTERS) out[f.id] = render(img, 150, withFilter(edits, f.id)).toDataURL('image/jpeg', 0.8);
      setTiles(out);
    }, 60);
    return () => window.clearTimeout(id);
  }, [tab, img, edits.geometry, edits.adjustments.filter((a) => a.id !== FILTER_ID).map((a) => JSON.stringify(a)).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the agent's last turn changed in these edits.
  const file = open ? `photos/${editsPathFor(open.path)}` : null;
  const [kept, setKept] = useState(false);
  const [was, setWas] = useState<PhotoEdits | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns('photo').includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
  }, [review?.conversation, file, open?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!review || kept || !file) { setWas(undefined); return; }
    void window.mobius.changes.before(review.conversation, file).then((r) => { if (live && r && r.ok) setWas(parseEdits(r.text)); }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, kept, file, open?.base]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = useMemo(() => {
    if (!was) return new Set<string>();
    const old = new Map(was.adjustments.map((a) => [a.id, JSON.stringify(a)]));
    const out = new Set(edits.adjustments.filter((a) => old.get(a.id) !== JSON.stringify(a)).map((a) => a.id));
    if (was.adjustments.some((a) => !edits.adjustments.some((b) => b.id === a.id))) out.add('(removed)');
    if (JSON.stringify(was.geometry ?? null) !== JSON.stringify(edits.geometry ?? null)) out.add('(crop)');
    return out;
  }, [was, edits]);
  const keep = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id, 'photo');
    setKept(true);
  };
  const discard = async () => {
    if (!review || !file) return;
    await window.mobius.changes.undoFile(review.conversation, file).catch(() => null);
    await photos.reload();
  };

  const sel = edits.adjustments.find((a) => a.id === photos.selected) ?? null;
  const set = (tag: string, fn: (a: Adjustment) => void) => {
    if (!sel) return;
    const next = structuredClone(edits);
    const a = next.adjustments.find((x) => x.id === sel.id);
    if (a) fn(a);
    photos.change(next, `${tag}:${sel.id}`);
  };
  const setGeometry = (next: Geometry, tag = '') => photos.change({ ...edits, geometry: isPlain(next) ? undefined : next }, tag);
  const add = () => {
    const used = new Set(edits.adjustments.map((a) => a.id));
    let n = edits.adjustments.filter((a) => a.id !== FILTER_ID && a.id !== 'auto').length + 1;
    while (used.has(`a${n}`)) n++;
    const a = blankAdjustment(`a${n}`, `Adjustment ${n}`);
    photos.change({ ...edits, adjustments: [...edits.adjustments, a] });
    photos.setSelected(a.id);
  };
  const remove = (id: string) => {
    const rest = edits.adjustments.filter((a) => a.id !== id);
    photos.change({ ...edits, adjustments: rest });
    if (photos.selected === id) photos.setSelected(rest[rest.length - 1]?.id ?? null);
  };
  const auto = edits.adjustments.find((a) => a.id === 'auto');
  const toggleAuto = () => {
    if (auto) { remove('auto'); return; }
    if (!img) return;
    const small = render(img, 300, { version: 1, adjustments: [], geometry: edits.geometry });
    const amounts = autoAmounts(small.getContext('2d')!.getImageData(0, 0, small.width, small.height).data);
    const a = { ...blankAdjustment('auto', 'Auto'), ...amounts };
    const at = edits.adjustments[0]?.id === FILTER_ID ? 1 : 0;
    photos.change({ ...edits, adjustments: [...edits.adjustments.slice(0, at), a, ...edits.adjustments.slice(at)] });
    photos.setSelected('auto');
  };
  const revert = () => { photos.change({ version: 1, adjustments: [] }); photos.setSelected(null); };
  const exportIt = async () => {
    if (!img) return;
    setBusy('Exporting…');
    await new Promise((r) => setTimeout(r, 30));
    const c = render(img, EXPORT_MAX, edits);
    const data = c.toDataURL('image/jpeg', 0.92).replace(/^data:[^,]*,/, '');
    const where = await photos.exportPicture(data);
    setBusy(where ? `Saved as ${where.split('/').pop()}` : '');
  };

  // Stepping through the album, and back to its grid with the thumbnail brought up to date.
  const album = photos.albums.find((a) => a.name === photos.album);
  const order = album?.photos.map((p) => p.path) ?? [];
  const at = open ? order.indexOf(open.path) : -1;
  const go = useCallback((step: number) => {
    const to = stepTo(order, open?.path ?? null, step);
    if (to && to !== open?.path) void photos.openPhoto(to);
  }, [order.join('|'), open?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = useCallback(() => {
    if (open) forgetThumb(open.path);
    photos.setBrowsing(true);
  }, [open?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys, as in Photos: arrows step through the album, M holds the original, Escape goes back; undo is per photo.
  const keys = useRef<(e: KeyboardEvent, down: boolean) => void>(() => {});
  keys.current = (e, down) => {
    if (typing(e.target) || e.altKey) return;
    if (!down) { if (e.key === 'm' || e.key === 'M') setBefore(false); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) photos.redo(); else photos.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); photos.redo(); return; }
    if (mod) return;
    if ((e.key === 'm' || e.key === 'M') && !e.repeat) { setBefore(true); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (cropping) setTab('adjust'); else back(); return; }
    if (cropping) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'z' || e.key === 'Z') setZoomed((z) => !z);
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current(e, true);
    const up = (e: KeyboardEvent) => keys.current(e, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const stopUndo = onCommand('undo', () => photos.undo());
    const stopRedo = onCommand('redo', () => photos.redo());
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); stopUndo(); stopRedo(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The crop box: dragged by its middle, sides and corners, kept to the aspect chosen.
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Geometry['crop'] } | null>(null);
  const frameAspect = img ? (() => { const [w, h] = turnedSize(img.naturalWidth, img.naturalHeight, geometry.turns); return w / h; })() : 1;
  const ratio = aspectRatio(aspect, frameAspect);
  const chooseAspect = (id: AspectId) => {
    setAspect(id);
    const r = aspectRatio(id, frameAspect);
    if (r !== null) setGeometry({ ...geometry, crop: fitAspect(geometry.crop, r, frameAspect) });
  };
  const cropDown = (handle: Handle) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: geometry.crop };
  };
  const cropMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const box = frame.current?.getBoundingClientRect();
    if (!d || !box) return;
    const crop = dragCrop(d.start, d.handle, (e.clientX - d.x) / box.width, (e.clientY - d.y) / box.height, ratio === null ? null : ratio / frameAspect);
    setGeometry({ ...geometry, crop }, `crop:${d.x}:${d.y}`);
  };
  const cropUp = () => { drag.current = null; };
  const nudgeCrop = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null;
    if (!d) return;
    e.preventDefault();
    setGeometry({ ...geometry, crop: dragCrop(geometry.crop, 'move', d[0]!, d[1]!, null) }, 'crop:keys');
  };

  if (!open) return null;
  const area = sel?.area;
  const showReview = changed.size > 0;
  const named = [...changed].filter((c) => !c.startsWith('(')).map((id) => edits.adjustments.find((a) => a.id === id)?.name ?? id);
  if (changed.has('(crop)')) named.push('the crop');
  const filter = filterOf(edits);
  const c = geometry.crop;
  return (
    <section className="photo-page photo-view" aria-label="Photo" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="photo-bar" role="toolbar" aria-label="Photo">
        <button type="button" className="photo-tool photo-back" aria-label={`Back to ${photos.album ?? 'the album'}`} title="Back to the album (Esc)" onClick={back}>
          <Icon d="M12.5 4.5L7 10l5.5 5.5" /><span>{photos.album}</span>
        </button>
        <div className="photo-bar-title">
          {/* The photo's name is the window toolbar's title already: here only where it sits in the album. */}
          <span className="photo-meta">{at >= 0 ? `${at + 1} of ${order.length}` : ''}{photos.saved ? '' : ' · Saving…'}</span>
        </div>
        <span className="spacer" />
        {busy && <span className="photo-meta" role="status">{busy}</span>}
        <div className="photo-tabs" role="tablist" aria-label="Edit">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" id={`photo-tab-${t.id}`} aria-controls="photo-tabpanel" aria-selected={tab === t.id} className="photo-tab" onClick={() => setTab(t.id)}>{t.name}</button>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="photo-tool" aria-pressed={before} title="Hold to see the original (M)" onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)} onKeyDown={(e) => { if (e.key === ' ') setBefore(true); }} onKeyUp={() => setBefore(false)}>
          <Icon d="M3 10c1.8-3.3 4.2-5 7-5s5.2 1.7 7 5c-1.8 3.3-4.2 5-7 5s-5.2-1.7-7-5zM10 12.3a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z" /><span>Show original</span>
        </button>
        <button type="button" className="photo-tool" disabled={edits.adjustments.length === 0 && isPlain(edits.geometry)} onClick={revert}>Revert</button>
        <button type="button" className="photo-export" disabled={!img} onClick={() => void exportIt()}>Export</button>
      </header>
      {photos.message && <p className="tasks-message" role="alert">{photos.message}</p>}
      <div className="photo-body">
        <div className="photo-stage" data-zoomed={zoomed || undefined} data-cropping={cropping || undefined}>
          {!cropping && at > 0 && <button type="button" className="photo-step prev glass-clear" aria-label="Previous photo" title="Previous photo (←)" onClick={() => go(-1)}><Icon d="M12.5 4.5L7 10l5.5 5.5" /></button>}
          {!cropping && at >= 0 && at < order.length - 1 && <button type="button" className="photo-step next glass-clear" aria-label="Next photo" title="Next photo (→)" onClick={() => go(1)}><Icon d="M7.5 4.5L13 10l-5.5 5.5" /></button>}
          <div className="photo-frame" ref={frame} onDoubleClick={() => { if (!cropping) setZoomed((z) => !z); }}>
            <canvas ref={shown} className="photo-canvas" role="img" aria-label={before ? 'The photo before edits' : 'The photo with edits'} />
            {sel && area && area.kind !== 'all' && !before && !cropping && (
              <div
                className="photo-area"
                data-kind={area.kind}
                aria-hidden="true"
                style={area.kind === 'ellipse'
                  ? { left: `${(area.cx - area.rx) * 100}%`, top: `${(area.cy - area.ry) * 100}%`, width: `${area.rx * 200}%`, height: `${area.ry * 200}%` }
                  : area.kind === 'below' ? { left: 0, right: 0, top: `${area.at * 100}%`, bottom: 0 } : { left: 0, right: 0, top: 0, height: `${area.at * 100}%` }}
              />
            )}
            {cropping && !before && (
              <div
                className="photo-crop" role="group" aria-label="Crop box" tabIndex={0}
                style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
                onPointerDown={cropDown('move')} onPointerMove={cropMove} onPointerUp={cropUp} onPointerCancel={cropUp} onKeyDown={nudgeCrop}
              >
                <span className="photo-crop-grid" aria-hidden="true" />
                {HANDLES.map((h) => <span key={h} className="photo-crop-handle" data-h={h} aria-hidden="true" onPointerDown={cropDown(h)} onPointerMove={cropMove} onPointerUp={cropUp} onPointerCancel={cropUp} />)}
              </div>
            )}
          </div>
          {showReview && (
            <div className="photo-review" role="group" aria-label="Mobius's change">
              <span className="review-dot" aria-hidden="true" />
              <span>{`Mobius changed ${named.join(', ') || 'the edits'}; nothing else touched.`}{review && <WhyThis conversation={review.conversation} />}</span>
              <ReviewActions onKeep={keep} onDiscard={discard} />
            </div>
          )}
        </div>
        <aside className="photo-panel" id="photo-tabpanel" role="tabpanel" aria-label={tab === 'adjust' ? 'Adjustments' : tab === 'filters' ? 'Filters' : 'Crop'}>
          {tab === 'adjust' && (
            <>
              <div className="photo-histogram" role="img" aria-label="Histogram of the photo's brightness">
                {bins.map((b, i) => <span key={i} style={{ height: `${Math.max(1, b * 100)}%` }} />)}
              </div>
              <div className="photo-panel-head">
                <span className="photo-panel-title">Layers</span>
                <button type="button" className="photo-chip" aria-pressed={auto !== undefined} title="Let Photo set the light and colour" onClick={toggleAuto}>
                  <Icon d="M10 3l1.6 3.9L15.5 8l-3.9 1.6L10 13.5 8.4 9.6 4.5 8l3.9-1.1zM15 13l.7 1.6 1.6.7-1.6.7L15 17.6l-.7-1.6-1.6-.7 1.6-.7z" />Auto
                </button>
                <button type="button" className="strip-btn" aria-label="Add adjustment" title="Add adjustment" onClick={add}><Icon d={PLUS} /></button>
              </div>
              <ul
                className="photo-layers" role="listbox" aria-label="Adjustment layers" tabIndex={0}
                onKeyDown={(e) => {
                  const list = [...edits.adjustments].reverse();
                  const i = list.findIndex((a) => a.id === photos.selected);
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const to = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (to) photos.setSelected(to.id); }
                  else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(sel.id); }
                }}
              >
                {[...edits.adjustments].reverse().map((a) => (
                  <li key={a.id} role="option" aria-selected={photos.selected === a.id} className="photo-layer" data-proposed={changed.has(a.id) || undefined} data-hidden={a.hidden || undefined} onClick={() => photos.setSelected(a.id)}>
                    <button type="button" tabIndex={-1} className="photo-eye" aria-label={a.hidden ? `Show ${a.name}` : `Hide ${a.name}`} onClick={(e) => { e.stopPropagation(); photos.change({ ...edits, adjustments: edits.adjustments.map((x) => (x.id === a.id ? { ...x, hidden: !x.hidden } : x)) }); }}>
                      {a.hidden ? <Icon d="M3 10c1.8-3.3 4.2-5 7-5s5.2 1.7 7 5c-1.8 3.3-4.2 5-7 5s-5.2-1.7-7-5zM4 4l12 12" /> : <Icon d="M3 10c1.8-3.3 4.2-5 7-5s5.2 1.7 7 5c-1.8 3.3-4.2 5-7 5s-5.2-1.7-7-5zM10 12.3a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z" />}
                    </button>
                    <span className="photo-layer-name">{a.name}</span>
                    <span className="photo-layer-area">{a.area.kind === 'all' ? '' : a.area.kind === 'ellipse' ? 'ellipse' : a.area.kind}</span>
                  </li>
                ))}
                <li className="photo-layer" data-base aria-disabled="true"><span className="photo-eye" aria-hidden="true" /><span className="photo-layer-name">Photo</span></li>
              </ul>
              {sel ? (
                <div className="photo-adjust" role="group" aria-label={`Adjustment ${sel.name}`}>
                  <label className="photo-field"><span>Name</span><input aria-label="Adjustment name" value={sel.name} maxLength={80} onChange={(e) => set('name', (a) => { a.name = e.target.value; })} /></label>
                  {AMOUNT_GROUPS.map((g) => (
                    <fieldset key={g.name} className="photo-group">
                      <legend>{g.name}</legend>
                      {g.amounts.map((k) => <Slider key={k} label={AMOUNT_NAMES[k]} value={sel[k]} onChange={(v) => set(`slider:${k}`, (a) => { a[k] = v; })} />)}
                    </fieldset>
                  ))}
                  <fieldset className="photo-group">
                    <legend>Where</legend>
                    <label className="photo-field"><span>Applies to</span>
                      <select aria-label="Applies to" value={sel.area.kind} onChange={(e) => set('area', (a) => { a.area.kind = e.target.value as AreaKind; })}>
                        {(Object.keys(AREA_NAMES) as AreaKind[]).map((k) => <option key={k} value={k}>{AREA_NAMES[k]}</option>)}
                      </select>
                    </label>
                    {(sel.area.kind === 'below' || sel.area.kind === 'above') && <Slider label="Line" min={0} max={100} value={Math.round(sel.area.at * 100)} onChange={(v) => set('slider:at', (a) => { a.area.at = v / 100; })} />}
                    {sel.area.kind === 'ellipse' && (
                      <>
                        <Slider label="Across" min={0} max={100} value={Math.round(sel.area.cx * 100)} onChange={(v) => set('slider:cx', (a) => { a.area.cx = v / 100; })} />
                        <Slider label="Down" min={0} max={100} value={Math.round(sel.area.cy * 100)} onChange={(v) => set('slider:cy', (a) => { a.area.cy = v / 100; })} />
                        <Slider label="Width" min={1} max={100} value={Math.round(sel.area.rx * 100)} onChange={(v) => set('slider:rx', (a) => { a.area.rx = v / 100; })} />
                        <Slider label="Height" min={1} max={100} value={Math.round(sel.area.ry * 100)} onChange={(v) => set('slider:ry', (a) => { a.area.ry = v / 100; })} />
                      </>
                    )}
                    {sel.area.kind !== 'all' && <Slider label="Softness" min={0} max={100} value={Math.round(sel.area.soft * 100)} onChange={(v) => set('slider:soft', (a) => { a.area.soft = v / 100; })} />}
                  </fieldset>
                  <button type="button" className="photo-delete" onClick={() => remove(sel.id)}>Delete adjustment</button>
                </div>
              ) : (
                <p className="photo-hint">Add an adjustment to change light and colour, to all of the photo or part of it, or press Auto. The picture itself is never changed: Export saves a new one.</p>
              )}
            </>
          )}
          {tab === 'filters' && (
            <div className="photo-filters" role="radiogroup" aria-label="Filters">
              {[{ id: 'original' as const, name: 'Original' }, ...FILTERS].map((f) => {
                const on = f.id === 'original' ? filter === null : filter === f.id;
                return (
                  <button key={f.id} type="button" role="radio" aria-checked={on} className="photo-filter" onClick={() => photos.change(withFilter(edits, f.id === 'original' ? null : f.id))}>
                    {tiles[f.id] ? <img src={tiles[f.id]} alt="" draggable={false} /> : <span className="photo-tile-wait" />}
                    <span>{f.name}</span>
                  </button>
                );
              })}
              <p className="photo-hint">A filter is a layer named for it, under your adjustments, so it can be changed in Adjust.</p>
            </div>
          )}
          {tab === 'crop' && (
            <div className="photo-cropper">
              <fieldset className="photo-group">
                <legend>Aspect</legend>
                <div className="photo-aspects" role="radiogroup" aria-label="Aspect">
                  {ASPECTS.map((a) => <button key={a.id} type="button" role="radio" aria-checked={aspect === a.id} className="photo-chip" onClick={() => chooseAspect(a.id)}>{a.name}</button>)}
                </div>
              </fieldset>
              <fieldset className="photo-group">
                <legend>Rotate</legend>
                <div className="photo-row">
                  <button type="button" className="photo-chip" onClick={() => setGeometry({ ...geometry, turns: ((geometry.turns + 1) % 4) as Geometry['turns'], crop: turnedCrop(geometry.crop) })}>
                    <Icon d="M6 7.5H3.5V5M3.8 7.4A7 7 0 1110 17" />Rotate left
                  </button>
                  <button type="button" className="photo-chip" aria-pressed={geometry.flip} onClick={() => setGeometry({ ...geometry, flip: !geometry.flip, crop: flippedCrop(geometry.crop) })}>
                    <Icon d="M10 3v14M7.5 6L3 14h4.5zM12.5 6L17 14h-4.5z" />Flip
                  </button>
                </div>
                <Slider label="Straighten" min={-45} max={45} step={0.5} value={geometry.straighten} onChange={(v) => setGeometry({ ...geometry, straighten: v }, 'slider:straighten')} />
              </fieldset>
              <div className="photo-row">
                <button type="button" className="photo-chip" disabled={isPlain(edits.geometry)} onClick={() => { setAspect('free'); setGeometry(plainGeometry()); }}>Reset</button>
                <span className="spacer" />
                <button type="button" className="photo-export" onClick={() => setTab('adjust')}>Done</button>
              </div>
              <p className="photo-hint">Drag the box or its corners; arrow keys nudge it. The crop is kept with the edits, so it can be changed later.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

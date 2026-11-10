import { FromMobius } from './FromMobius';
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { AMOUNTS, AMOUNT_NAMES, applyEdits, blankAdjustment, describePixels, editsPathFor, parseEdits, type Adjustment, type AreaKind, type PhotoEdits } from './photo-edit';
import type { PhotosState } from './usePhotos';
import { ReviewActions, WhyThis } from './ReviewBar';

const PREVIEW_MAX = 1600;
const EXPORT_MAX = 6000;

/** Albums and their photos; pictures dropped on the window go into the album open. */
export function PhotoSidebar({ photos, pin, changed }: { photos: PhotosState; pin?: ReactNode; changed?: ReadonlySet<string> }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await photos.createAlbum(name.trim() || 'Album')) { setNaming(false); setName(''); } };
  const here = photos.open?.path.split('/')[0];
  return (
    <aside className="side photo-side" aria-label="Photo sidebar">
      <div className="side-head">
        <span className="side-title">Albums</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New album" title="New album" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
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
        {photos.albums.map((a) => (
          <section key={a.name} aria-label={a.name}>
            <h3 className="photo-album-name" data-here={a.name === here || undefined}>{a.name}</h3>
            {a.photos.length === 0 && <p className="photo-drop-hint">Drop pictures on the window to add them here.</p>}
            <ul role="list">
              {a.photos.map((p) => (
                <li key={p.path}>
                  <button type="button" className="list-row" aria-current={photos.open?.path === p.path ? 'page' : undefined} onClick={() => void photos.openPhoto(p.path)}>
                    <span className="list-name">{p.name}</span>
                    {changed?.has(p.path) && <span className="changed-mark" role="img" aria-label="Changed by the agent" title="Edited by the agent in its last turn" />}
                    {p.edited && <span className="photo-edited" title="Has edits">●</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
      <FromMobius items={photos.albums.flatMap((a) => a.photos.filter((p) => changed?.has(p.path)).map((p) => ({ key: p.path, name: p.name, where: a.name, current: photos.open?.path === p.path, onOpen: () => void photos.openPhoto(p.path) })))} />
    </aside>
  );
}

function Slider({ label, value, min = -100, max = 100, step = 1, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="photo-slider">
      <span className="photo-slider-head"><span>{label}</span><output>{value}</output></span>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(min < 0 ? 0 : Math.round((min + max) / 2))} />
    </label>
  );
}

const AREA_NAMES: Record<AreaKind, string> = { all: 'All of the photo', below: 'Below a line', above: 'Above a line', ellipse: 'Inside an ellipse' };

/** Draws a picture with edits onto a canvas, no bigger than `max` on its long side. */
function draw(img: HTMLImageElement, max: number, edits: PhotoEdits | null): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (edits) {
    const data = ctx.getImageData(0, 0, c.width, c.height);
    applyEdits(data.data, c.width, c.height, edits);
    ctx.putImageData(data, 0, 0);
  }
  return c;
}

/** The open photo with its adjustments, the adjustments as layers, and what Mobius changed to keep or put back. */
export function PhotoEditor({ photos, review }: { photos: PhotosState; review?: { conversation: string } | null }) {
  const shown = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [before, setBefore] = useState(false);
  const [busy, setBusy] = useState('');
  const { open, edits } = photos;

  // The picture, read once per photo.
  useEffect(() => {
    if (!open) { setImg(null); return; }
    const i = new Image();
    i.onload = () => {
      setImg(i);
      const small = draw(i, 400, null);
      const ctx = small.getContext('2d')!;
      photos.setDescribed(describePixels(ctx.getImageData(0, 0, small.width, small.height).data, i.naturalWidth, i.naturalHeight).replace(/^\d+ × \d+/, `${i.naturalWidth} × ${i.naturalHeight}`));
    };
    i.onerror = () => photos.setMessage('This picture could not be opened.');
    i.src = open.dataUrl;
  }, [open?.dataUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redrawn as the edits change, at most once a frame.
  useEffect(() => {
    if (!img || !shown.current) return;
    const id = requestAnimationFrame(() => {
      const c = draw(img, PREVIEW_MAX, before ? null : edits);
      const target = shown.current;
      if (!target) return;
      target.width = c.width;
      target.height = c.height;
      target.getContext('2d')!.drawImage(c, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [img, edits, before]);

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
      if (live) setKept(id !== null && keptTurns().includes(id));
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
    return out;
  }, [was, edits]);
  const keep = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
    setKept(true);
  };
  const discard = async () => {
    if (!review || !file) return;
    await window.mobius.changes.undoFile(review.conversation, file).catch(() => null);
    await photos.reload();
  };

  const sel = edits.adjustments.find((a) => a.id === photos.selected) ?? null;
  const set = (fn: (a: Adjustment) => void) => {
    if (!sel) return;
    const next = structuredClone(edits);
    const a = next.adjustments.find((x) => x.id === sel.id);
    if (a) fn(a);
    photos.change(next);
  };
  const add = () => {
    const used = new Set(edits.adjustments.map((a) => a.id));
    let n = edits.adjustments.length + 1;
    while (used.has(`a${n}`)) n++;
    const a = blankAdjustment(`a${n}`, `Adjustment ${n}`);
    photos.change({ ...edits, adjustments: [...edits.adjustments, a] });
    photos.setSelected(a.id);
  };
  const remove = (id: string) => photos.change({ ...edits, adjustments: edits.adjustments.filter((a) => a.id !== id) });
  const exportIt = async () => {
    if (!img) return;
    setBusy('Exporting…');
    await new Promise((r) => setTimeout(r, 30));
    const c = draw(img, EXPORT_MAX, edits);
    const data = c.toDataURL('image/jpeg', 0.92).replace(/^data:[^,]*,/, '');
    const where = await photos.exportPicture(data);
    setBusy(where ? `Saved as ${where.split('/').pop()}` : '');
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /^image\//.test(f.type));
    const album = photos.open?.path.split('/')[0] ?? photos.albums[0]?.name;
    if (files.length && album) void photos.addFiles(album, files);
  };

  if (!photos.available) return <section className="photo-page empty" aria-label="Photo"><p className="note-empty">Photo is not available here.</p></section>;
  if (!open) {
    return (
      <section className="photo-page empty" aria-label="Photo" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <p className="note-empty">{photos.albums.length === 0 ? 'Make an album, then drop pictures on the window to add them.' : 'Choose a photo, or drop pictures here to add them to the album.'}</p>
      </section>
    );
  }
  const area = sel?.area;
  const showReview = changed.size > 0;
  return (
    <section className="photo-page" aria-label="Photo" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="photo-head">
        <span className="photo-title">{open.path.split('/').pop()}</span>
        <span className="photo-meta">{photos.described.split('.')[0]}{photos.saved ? '' : ' · Saving…'}</span>
        <span className="photo-head-actions">
          {busy && <span className="photo-meta" role="status">{busy}</span>}
          <button type="button" className="btn" aria-pressed={before} onPointerDown={() => setBefore(true)} onPointerUp={() => setBefore(false)} onPointerLeave={() => setBefore(false)} onKeyDown={(e) => { if (e.key === ' ') setBefore(true); }} onKeyUp={() => setBefore(false)}>Show before</button>
          <button type="button" className="btn primary" disabled={!img} onClick={() => void exportIt()}>Export</button>
        </span>
      </header>
      {photos.message && <p className="tasks-message" role="alert">{photos.message}</p>}
      <div className="photo-body">
        <div className="photo-stage">
          <div className="photo-frame">
            <canvas ref={shown} className="photo-canvas" role="img" aria-label={before ? 'The photo before edits' : 'The photo with edits'} />
            {sel && area && area.kind !== 'all' && !before && (
              <div
                className="photo-area"
                data-kind={area.kind}
                aria-hidden="true"
                style={area.kind === 'ellipse'
                  ? { left: `${(area.cx - area.rx) * 100}%`, top: `${(area.cy - area.ry) * 100}%`, width: `${area.rx * 200}%`, height: `${area.ry * 200}%` }
                  : area.kind === 'below' ? { left: 0, right: 0, top: `${area.at * 100}%`, bottom: 0 } : { left: 0, right: 0, top: 0, height: `${area.at * 100}%` }}
              />
            )}
          </div>
          {showReview && (
            <div className="photo-review" role="group" aria-label="Mobius's change">
              <span className="review-dot" aria-hidden="true" />
              <span>{`Mobius changed ${[...changed].filter((c) => c !== '(removed)').map((id) => edits.adjustments.find((a) => a.id === id)?.name ?? id).join(', ') || 'the edits'}; nothing else touched.`}{review && <WhyThis conversation={review.conversation} />}</span>
              <ReviewActions onKeep={keep} onDiscard={discard} />
            </div>
          )}
        </div>
        <aside className="photo-panel" aria-label="Adjustments">
          <div className="design-panel-title photo-panel-head">
            <span>Layers</span>
            <button type="button" className="strip-btn" aria-label="Add adjustment" title="Add adjustment" onClick={add}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg></button>
          </div>
          <ul className="photo-layers" role="listbox" aria-label="Adjustment layers">
            {[...edits.adjustments].reverse().map((a) => (
              <li key={a.id} role="option" aria-selected={photos.selected === a.id} className="photo-layer" data-proposed={changed.has(a.id) || undefined} data-hidden={a.hidden || undefined} onClick={() => photos.setSelected(a.id)}>
                <button type="button" className="photo-eye" aria-label={a.hidden ? `Show ${a.name}` : `Hide ${a.name}`} onClick={(e) => { e.stopPropagation(); photos.change({ ...edits, adjustments: edits.adjustments.map((x) => (x.id === a.id ? { ...x, hidden: !x.hidden } : x)) }); }}>{a.hidden ? '○' : '◉'}</button>
                <span className="photo-layer-name">{a.name}</span>
                <span className="photo-layer-area">{a.area.kind === 'all' ? '' : a.area.kind === 'ellipse' ? 'ellipse' : a.area.kind}</span>
              </li>
            ))}
            <li className="photo-layer" data-base aria-disabled="true"><span className="photo-eye" aria-hidden="true">◉</span><span className="photo-layer-name">Photo</span></li>
          </ul>
          {sel ? (
            <div className="photo-adjust" role="group" aria-label={`Adjustment ${sel.name}`}>
              <label className="design-text"><span>Name</span><input aria-label="Adjustment name" value={sel.name} maxLength={80} onChange={(e) => set((a) => { a.name = e.target.value; })} /></label>
              {AMOUNTS.map((k) => <Slider key={k} label={AMOUNT_NAMES[k]} value={sel[k]} onChange={(v) => set((a) => { a[k] = v; })} />)}
              <label className="design-text"><span>Applies to</span>
                <select aria-label="Applies to" value={sel.area.kind} onChange={(e) => set((a) => { a.area.kind = e.target.value as AreaKind; })}>
                  {(Object.keys(AREA_NAMES) as AreaKind[]).map((k) => <option key={k} value={k}>{AREA_NAMES[k]}</option>)}
                </select>
              </label>
              {(sel.area.kind === 'below' || sel.area.kind === 'above') && <Slider label="Line" min={0} max={100} value={Math.round(sel.area.at * 100)} onChange={(v) => set((a) => { a.area.at = v / 100; })} />}
              {sel.area.kind === 'ellipse' && (
                <>
                  <Slider label="Across" min={0} max={100} value={Math.round(sel.area.cx * 100)} onChange={(v) => set((a) => { a.area.cx = v / 100; })} />
                  <Slider label="Down" min={0} max={100} value={Math.round(sel.area.cy * 100)} onChange={(v) => set((a) => { a.area.cy = v / 100; })} />
                  <Slider label="Width" min={1} max={100} value={Math.round(sel.area.rx * 100)} onChange={(v) => set((a) => { a.area.rx = v / 100; })} />
                  <Slider label="Height" min={1} max={100} value={Math.round(sel.area.ry * 100)} onChange={(v) => set((a) => { a.area.ry = v / 100; })} />
                </>
              )}
              {sel.area.kind !== 'all' && <Slider label="Softness" min={0} max={100} value={Math.round(sel.area.soft * 100)} onChange={(v) => set((a) => { a.area.soft = v / 100; })} />}
              <button type="button" className="btn danger" onClick={() => remove(sel.id)}>Delete adjustment</button>
            </div>
          ) : (
            <p className="design-hint">Add an adjustment to change exposure, contrast, colour and warmth, to all of the photo or part of it. The picture itself is never changed: Export saves a new one.</p>
          )}
        </aside>
      </div>
    </section>
  );
}

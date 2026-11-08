import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { NotesSidebar, type SidebarWords } from './NotesSidebar';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { changedIds, contrast, freshId, nextFramePlace, parseDesign, resolveColor, writeDesign, type Align, type DesignDoc, type DesignFrame, type DesignNode, type NodeType } from './design-format';
import type { NotesState } from './useNotes';
import { onCommand } from './commands';
import { useUndo } from './useUndo';

export const DESIGN_WORDS: SidebarWords = { app: 'Design', group: 'folder', groups: 'Folders', item: 'design', items: 'designs', about: 'Designs are kept as JSON files in your workspace, frames and their layers, so the agent can read and change them too.', defaultGroup: 'Designs' };

export function DesignSidebar(props: { designs: NotesState; pin: ReactNode; changed?: ReadonlySet<string> }) {
  const { designs, ...rest } = props;
  return <NotesSidebar notes={designs} words={DESIGN_WORDS} {...rest} />;
}

type Drag = { id: string; mode: 'move' | 'resize'; startX: number; startY: number; dx: number; dy: number } | { id: null; mode: 'pan'; startX: number; startY: number; panX: number; panY: number };

function findNode(doc: DesignDoc, id: string | null): { frame: DesignFrame; node: DesignNode | null } | null {
  for (const frame of doc.frames) {
    if (frame.id === id) return { frame, node: null };
    const node = frame.children.find((c) => c.id === id);
    if (node) return { frame, node };
  }
  return null;
}

/** What Mobius changed in the open design in its last turn: kept, or the design as it was before. */
function useDesignReview(review: { conversation: string } | null | undefined, file: string | null, version: unknown) {
  const [kept, setKept] = useState(false);
  const [before, setBefore] = useState<DesignDoc | null | undefined>(undefined);
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
  }, [review?.conversation, file, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (!review || kept || !file) { setBefore(undefined); return; }
    void window.mobius.changes.before(review.conversation, file).then((was) => {
      if (!live || !was || !was.ok) return;
      const parsed = was.text === null ? null : parseDesign(was.text);
      setBefore(parsed === null ? null : 'doc' in parsed ? parsed.doc : undefined);
    }).catch(() => {});
    return () => { live = false; };
  }, [review?.conversation, kept, file, version]); // eslint-disable-line react-hooks/exhaustive-deps
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
  };
  return { before, keep, discard };
}

function Field({ label, value, onChange, min, step = 1, wide }: { label: string; value: number; onChange: (n: number) => void; min?: number; step?: number; wide?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const done = () => { const n = Number(text); if (Number.isFinite(n) && text.trim() !== '') onChange(min !== undefined ? Math.max(min, n) : n); else setText(String(value)); };
  return (
    <label className="design-field" data-wide={wide || undefined}>
      <span>{label}</span>
      <input aria-label={label} inputMode="decimal" value={text} step={step} onChange={(e) => setText(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') { done(); (e.target as HTMLInputElement).blur(); } }} />
    </label>
  );
}

function ColorField({ label, value, doc, onChange }: { label: string; value: string; doc: DesignDoc; onChange: (c: string) => void }) {
  const shown = resolveColor(value, doc.styles);
  const plain = /^#[0-9a-f]{6}/i.test(shown) ? shown.slice(0, 7) : '#000000';
  return (
    <div className="design-color">
      <span className="design-color-label">{label}</span>
      <input type="color" aria-label={`${label} colour`} value={plain} onChange={(e) => onChange(e.target.value)} />
      <select aria-label={`${label} style`} value={value.startsWith('style:') ? value : ''} onChange={(e) => onChange(e.target.value || plain)}>
        <option value="">{value === 'transparent' ? 'None' : value.startsWith('style:') ? plain : value}</option>
        {doc.styles.map((s) => <option key={s.name} value={`style:${s.name}`}>{s.name}</option>)}
      </select>
    </div>
  );
}

/** One design: frames on a canvas to move, size and colour, its layers, an inspector, and Mobius's changes dashed. */
export function DesignEditor({ designs, review }: { designs: NotesState; review?: { conversation: string } | null }) {
  const parsed = useMemo(() => (designs.page ? parseDesign(designs.text) : null), [designs.page, designs.text]);
  const doc = parsed && 'doc' in parsed ? parsed.doc : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const file = designs.page ? `designs/${designs.page.path}` : null;
  const { before, keep, discard } = useDesignReview(review, file, designs.page?.base);
  const changed = useMemo(() => (doc && before !== undefined ? changedIds(before, doc) : new Set<string>()), [doc, before]);

  const history = useUndo(designs.page?.path ?? null, designs.text, designs.edit);
  const change = useCallback((fn: (d: DesignDoc) => void) => {
    if (!doc) return;
    const next = structuredClone(doc);
    fn(next);
    const text = writeDesign(next);
    history.record(designs.text, text);
    designs.edit(text);
  }, [doc, designs, history]);
  // Undo and redo from the Edit menu.
  const historyNow = useRef(history);
  historyNow.current = history;
  useEffect(() => {
    const offUndo = onCommand('undo', () => void historyNow.current.undo());
    const offRedo = onCommand('redo', () => void historyNow.current.redo());
    return () => { offUndo(); offRedo(); };
  }, []);

  const fit = useCallback(() => {
    if (!doc || !view.current || doc.frames.length === 0) return;
    const left = Math.min(...doc.frames.map((f) => f.x)), top = Math.min(...doc.frames.map((f) => f.y));
    const right = Math.max(...doc.frames.map((f) => f.x + f.w)), bottom = Math.max(...doc.frames.map((f) => f.y + f.h));
    const { width, height } = view.current.getBoundingClientRect();
    const z = Math.max(0.05, Math.min(2, (width - 80) / (right - left || 1), (height - 100) / (bottom - top || 1)));
    setZoom(Math.round(z * 100) / 100);
    setPan({ x: (width - (right - left) * z) / 2 - left * z, y: 50 - top * z });
  }, [doc]);
  // A design opens fitted to the window.
  const fitted = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (doc && designs.page && fitted.current !== designs.page.path) { fitted.current = designs.page.path; setSelected(null); fit(); }
  }, [doc, designs.page, fit]);

  // Moving and sizing follow the pointer and are written once, when it is let go.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.mode === 'pan') setPan({ x: drag.panX + e.clientX - drag.startX, y: drag.panY + e.clientY - drag.startY });
      else setDrag({ ...drag, dx: Math.round((e.clientX - drag.startX) / zoom), dy: Math.round((e.clientY - drag.startY) / zoom) });
    };
    const up = () => {
      if (drag.mode !== 'pan' && (drag.dx || drag.dy)) {
        change((d) => {
          const at = findNode(d, drag.id);
          const target = at?.node ?? at?.frame;
          if (!target) return;
          if (drag.mode === 'move') { target.x += drag.dx; target.y += drag.dy; } else { target.w = Math.max(1, target.w + drag.dx); target.h = Math.max(1, target.h + drag.dy); }
        });
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, zoom, change]);

  const startDrag = (e: ReactPointerEvent, id: string, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(id);
    setDrag({ id, mode, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 });
  };
  const live = (id: string, x: number, y: number, w: number, h: number) => {
    if (!drag || drag.mode === 'pan' || drag.id !== id) return { x, y, w, h };
    return drag.mode === 'move' ? { x: x + drag.dx, y: y + drag.dy, w, h } : { x, y, w: Math.max(1, w + drag.dx), h: Math.max(1, h + drag.dy) };
  };

  const add = (type: NodeType | 'frame') => change((d) => {
    if (type === 'frame') {
      const id = freshId(d, 'f');
      d.frames.push({ id, name: `Frame ${d.frames.length + 1}`, ...nextFramePlace(d), w: 393, h: 852, fill: '#ffffff', radius: 0, children: [] });
      setSelected(id);
      return;
    }
    const at = findNode(d, selected) ?? (d.frames[0] ? { frame: d.frames[0], node: null } : null);
    if (!at) return;
    const id = freshId(d, 'n');
    const w = type === 'text' ? 200 : 120, h = type === 'text' ? 32 : 120;
    at.frame.children.push({ id, type, name: type === 'text' ? 'Text' : type === 'ellipse' ? 'Ellipse' : 'Rectangle', x: Math.round((at.frame.w - w) / 2), y: Math.round((at.frame.h - h) / 2), w, h, fill: type === 'text' ? 'transparent' : '#d9d9de', radius: 0, opacity: 1, text: type === 'text' ? 'Text' : '', size: 20, weight: 400, color: '#1d1d1f', align: 'left' });
    setSelected(id);
  });
  const remove = useCallback(() => change((d) => {
    d.frames = d.frames.filter((f) => f.id !== selected);
    for (const f of d.frames) f.children = f.children.filter((c) => c.id !== selected);
    setSelected(null);
  }), [change, selected]);
  const nudge = useCallback((dx: number, dy: number) => change((d) => { const at = findNode(d, selected); const t = at?.node ?? at?.frame; if (t) { t.x += dx; t.y += dy; } }), [change, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (!t?.closest('.design-page')) return;
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'y' || e.shiftKey) history.redo(); else history.undo();
        return;
      }
      if (!selected) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, remove, nudge, history]);

  if (!designs.page) return <section className="design-page empty" aria-label="Design"><p className="note-empty">Choose a design on the left, or make a new one.</p></section>;
  if (!doc) {
    return (
      <section className="design-page empty" aria-label="Design">
        <p className="note-empty">This design could not be read ({parsed && 'error' in parsed ? parsed.error : 'unknown'}). Fix the file, or put back what Mobius changed.</p>
      </section>
    );
  }
  const at = findNode(doc, selected);
  const setNode = (fn: (n: DesignNode) => void) => change((d) => { const n = findNode(d, selected)?.node; if (n) fn(n); });
  const setFrame = (fn: (f: DesignFrame) => void) => change((d) => { const f = findNode(d, selected)?.frame; if (f) fn(f); });
  const textContrast = at?.node?.type === 'text' ? contrast(resolveColor(at.node.color, doc.styles), resolveColor(at.frame.fill, doc.styles)) : null;
  const showReview = changed.size > 0;
  const nodeStyle = (n: DesignNode): CSSProperties => {
    const p = live(n.id, n.x, n.y, n.w, n.h);
    return {
      left: p.x, top: p.y, width: p.w, height: p.h, opacity: n.opacity,
      background: n.fill === 'transparent' ? undefined : resolveColor(n.fill, doc.styles),
      borderRadius: n.type === 'ellipse' ? '50%' : n.radius,
      ...(n.type === 'text' ? { color: resolveColor(n.color, doc.styles), fontSize: n.size, fontWeight: n.weight, textAlign: n.align, lineHeight: 1.25 } : {}),
    };
  };

  return (
    <section className="design-page" aria-label="Design">
      <div className="design-bar" role="toolbar" aria-label="Design tools">
        <button type="button" className="btn" onClick={() => add('frame')}>Frame</button>
        <button type="button" className="btn" onClick={() => add('rect')} disabled={doc.frames.length === 0}>Rectangle</button>
        <button type="button" className="btn" onClick={() => add('ellipse')} disabled={doc.frames.length === 0}>Ellipse</button>
        <button type="button" className="btn" onClick={() => add('text')} disabled={doc.frames.length === 0}>Text</button>
        <span className="design-bar-gap" />
        <button type="button" className="strip-btn" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.05, Math.round(z * 80) / 100))}>−</button>
        <span className="design-zoom" aria-label="Zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="strip-btn" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, Math.round(z * 125) / 100))}>+</button>
        <button type="button" className="btn" onClick={fit}>Fit</button>
      </div>
      <div className="design-body">
        <nav className="design-layers" aria-label="Layers">
          <div className="design-panel-title">Layers</div>
          <ul role="tree" aria-label="Frames and layers">
            {doc.frames.map((f) => (
              <li key={f.id} role="treeitem" aria-selected={selected === f.id} aria-expanded>
                <button type="button" className="design-layer" data-frame aria-current={selected === f.id || undefined} data-changed={changed.has(f.id) || undefined} onClick={() => setSelected(f.id)}>#{' '}{f.name}</button>
                <ul role="group">
                  {[...f.children].reverse().map((n) => (
                    <li key={n.id} role="treeitem" aria-selected={selected === n.id}>
                      <button type="button" className="design-layer" aria-current={selected === n.id || undefined} data-changed={changed.has(n.id) || undefined} onClick={() => setSelected(n.id)}>
                        <span className="design-layer-kind" aria-hidden="true">{n.type === 'text' ? 'T' : n.type === 'ellipse' ? '○' : '□'}</span>{n.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
        <div
          className="design-view"
          ref={view}
          role="application"
          aria-label="Canvas"
          tabIndex={0}
          onPointerDown={(e) => { if (e.button === 0) { setSelected(null); setDrag({ id: null, mode: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }); } }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              const rect = e.currentTarget.getBoundingClientRect();
              const z = Math.max(0.05, Math.min(4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
              const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
              setPan({ x: cx - ((cx - pan.x) * z) / zoom, y: cy - ((cy - pan.y) * z) / zoom });
              setZoom(Math.round(z * 100) / 100);
            } else setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
          }}
        >
          <div className="design-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            {doc.frames.map((f) => {
              const p = live(f.id, f.x, f.y, f.w, f.h);
              return (
                <div key={f.id} className="design-frame" data-selected={selected === f.id || undefined} data-proposed={changed.has(f.id) || undefined} aria-label={`Frame ${f.name}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h, background: resolveColor(f.fill, doc.styles), borderRadius: f.radius }}>
                  <span className="design-frame-name" style={{ fontSize: 12 / zoom, top: -18 / zoom }} onPointerDown={(e) => startDrag(e, f.id, 'move')}>{f.name}</span>
                  <div className="design-clip" style={{ borderRadius: f.radius }} onPointerDown={(e) => { if (e.target === e.currentTarget) startDrag(e, f.id, 'move'); }}>
                    {f.children.map((n) => (
                      <div key={n.id} className="design-node" data-type={n.type} data-selected={selected === n.id || undefined} data-proposed={changed.has(n.id) || undefined} aria-label={`${n.type === 'text' ? 'Text' : n.type === 'ellipse' ? 'Ellipse' : 'Rectangle'} ${n.name}`} style={nodeStyle(n)} onPointerDown={(e) => startDrag(e, n.id, 'move')}>
                        {n.type === 'text' ? n.text : null}
                      </div>
                    ))}
                  </div>
                  {selected && at && (at.node ? at.frame.id === f.id : selected === f.id) && (() => {
                    const t = at.node ?? at.frame;
                    const q = live(t.id, t.x, t.y, t.w, t.h);
                    const box = at.node ? { left: q.x, top: q.y, width: q.w, height: q.h } : { left: 0, top: 0, width: q.w, height: q.h };
                    return (
                      <div className="design-handles" style={{ ...box, borderWidth: 1.5 / zoom }}>
                        <span className="design-handle" style={{ width: 9 / zoom, height: 9 / zoom, right: -5 / zoom, bottom: -5 / zoom }} onPointerDown={(e) => startDrag(e, t.id, 'resize')} aria-hidden="true" />
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
          {showReview && (
            <div className="design-review" role="group" aria-label="Mobius's change" onPointerDown={(e) => e.stopPropagation()}>
              <span className="review-dot" aria-hidden="true" />
              <span>{changed.size === 1 ? 'Mobius changed one layer here, dashed.' : `Mobius changed ${changed.size} layers here, dashed.`}</span>
              <button type="button" className="review-btn" onClick={() => void discard()}>Discard</button>
              <button type="button" className="review-btn" data-kind="keep" onClick={() => void keep()}>Keep</button>
            </div>
          )}
        </div>
        <aside className="design-inspector" aria-label="Inspector">
          {!at && (
            <>
              <div className="design-panel-title">Colour styles</div>
              {doc.styles.length === 0 && <p className="design-hint">None yet. A style is a named colour layers can use, so changing it changes them all.</p>}
              <ul className="design-styles" aria-label="Colour styles">
                {doc.styles.map((s, i) => (
                  <li key={i}>
                    <input type="color" aria-label={`${s.name} colour`} value={/^#[0-9a-f]{6}/i.test(s.color) ? s.color.slice(0, 7) : '#000000'} onChange={(e) => change((d) => { d.styles[i]!.color = e.target.value; })} />
                    <span>{s.name}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="btn" onClick={() => change((d) => { let n = d.styles.length + 1; while (d.styles.some((s) => s.name === `Colour ${n}`)) n++; d.styles.push({ name: `Colour ${n}`, color: '#5856d6' }); })}>Add style</button>
              <p className="design-hint">Select a frame or a layer to change it. Drag the canvas to move around; Ctrl and the wheel zoom.</p>
            </>
          )}
          {at && !at.node && (
            <>
              <div className="design-panel-title">Frame</div>
              <label className="design-text"><span>Name</span><input aria-label="Name" value={at.frame.name} maxLength={80} onChange={(e) => setFrame((f) => { f.name = e.target.value; })} /></label>
              <div className="design-grid">
                <Field label="X" value={at.frame.x} onChange={(v) => setFrame((f) => { f.x = v; })} />
                <Field label="Y" value={at.frame.y} onChange={(v) => setFrame((f) => { f.y = v; })} />
                <Field label="W" value={at.frame.w} min={1} onChange={(v) => setFrame((f) => { f.w = v; })} />
                <Field label="H" value={at.frame.h} min={1} onChange={(v) => setFrame((f) => { f.h = v; })} />
                <Field label="Radius" value={at.frame.radius} min={0} onChange={(v) => setFrame((f) => { f.radius = v; })} wide />
              </div>
              <ColorField label="Fill" value={at.frame.fill} doc={doc} onChange={(c) => setFrame((f) => { f.fill = c; })} />
              <button type="button" className="btn danger" onClick={remove}>Delete frame</button>
            </>
          )}
          {at?.node && (
            <>
              <div className="design-panel-title">{at.node.type === 'text' ? 'Text' : at.node.type === 'ellipse' ? 'Ellipse' : 'Rectangle'}</div>
              <label className="design-text"><span>Name</span><input aria-label="Name" value={at.node.name} maxLength={80} onChange={(e) => setNode((n) => { n.name = e.target.value; })} /></label>
              <div className="design-grid">
                <Field label="X" value={at.node.x} onChange={(v) => setNode((n) => { n.x = v; })} />
                <Field label="Y" value={at.node.y} onChange={(v) => setNode((n) => { n.y = v; })} />
                <Field label="W" value={at.node.w} min={1} onChange={(v) => setNode((n) => { n.w = v; })} />
                <Field label="H" value={at.node.h} min={1} onChange={(v) => setNode((n) => { n.h = v; })} />
                {at.node.type === 'rect' && <Field label="Radius" value={at.node.radius} min={0} onChange={(v) => setNode((n) => { n.radius = v; })} />}
                <Field label="Opacity" value={Math.round(at.node.opacity * 100)} min={0} onChange={(v) => setNode((n) => { n.opacity = Math.min(100, v) / 100; })} />
              </div>
              {at.node.type === 'text' && (
                <>
                  <label className="design-text"><span>Text</span><textarea aria-label="Text" value={at.node.text} rows={3} maxLength={2000} onChange={(e) => setNode((n) => { n.text = e.target.value; })} /></label>
                  <div className="design-grid">
                    <Field label="Size" value={at.node.size} min={4} onChange={(v) => setNode((n) => { n.size = v; })} />
                    <Field label="Weight" value={at.node.weight} min={100} step={100} onChange={(v) => setNode((n) => { n.weight = Math.min(900, Math.round(v / 100) * 100); })} />
                  </div>
                  <label className="design-text"><span>Align</span>
                    <select aria-label="Align" value={at.node.align} onChange={(e) => setNode((n) => { n.align = e.target.value as Align; })}>
                      <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
                    </select>
                  </label>
                  <ColorField label="Colour" value={at.node.color} doc={doc} onChange={(c) => setNode((n) => { n.color = c; })} />
                  {textContrast !== null && <p className="design-hint" data-bad={textContrast < 4.5 || undefined}>Contrast with the frame {textContrast}:1 · {textContrast >= 4.5 ? 'passes AA' : 'below AA (4.5:1)'}</p>}
                </>
              )}
              <ColorField label="Fill" value={at.node.fill} doc={doc} onChange={(c) => setNode((n) => { n.fill = c; })} />
              <div className="design-row">
                <button type="button" className="btn" onClick={() => change((d) => { const a = findNode(d, selected); if (!a?.node) return; const i = a.frame.children.indexOf(a.node); if (i < a.frame.children.length - 1) { a.frame.children.splice(i, 1); a.frame.children.splice(i + 1, 0, a.node); } })}>Forward</button>
                <button type="button" className="btn" onClick={() => change((d) => { const a = findNode(d, selected); if (!a?.node) return; const i = a.frame.children.indexOf(a.node); if (i > 0) { a.frame.children.splice(i, 1); a.frame.children.splice(i - 1, 0, a.node); } })}>Backward</button>
              </div>
              <button type="button" className="btn danger" onClick={remove}>Delete layer</button>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

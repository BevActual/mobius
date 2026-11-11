import { RowMark } from './RowMark';
import { FromMobius } from './FromMobius';
import { EmptyState } from './EmptyState';
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { changedShots, cutLength, freshShotId, locate, parseCut, shotLength, shotStart, timecode, type Shot } from './cut-format';
import { useFileReview } from './useFileReview';
import type { VideoState } from './useVideo';
import { ReviewActions, WhyThis } from './ReviewBar';

/** Video projects, and the open project's footage: clips to add to the cut. */
export function VideoSidebar({ video, pin, changed }: { video: VideoState; pin?: ReactNode; changed?: ReadonlySet<string> }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await video.createProject(name.trim() || 'Project')) { setNaming(false); setName(''); } };
  const addShot = (clip: string) => {
    const len = video.lengthOf(clip) ?? 5;
    video.change({ ...video.cut, shots: [...video.cut.shots, { id: freshShotId(video.cut), clip, in: 0, out: Math.round(Math.min(len || 5, 6) * 100) / 100, title: '' }] });
  };
  return (
    <aside className="side video-side" aria-label="Video sidebar">
      <div className="side-head">
        <span className="side-title">Projects</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New project" title="New project" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Project name" placeholder="Project name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      <nav className="task-lists" aria-label="Video projects">
        {video.projects.length === 0 && !naming && (
          <div className="side-empty notes-empty">
            <p>A project is a folder of clips in your workspace and its cut. The clips are never changed.</p>
            <button type="button" className="btn primary" onClick={() => setNaming(true)}>New project</button>
          </div>
        )}
        <ul role="list">
          {video.projects.map((p) => (
            <li key={p.name}>
              <button type="button" className="list-row" aria-current={video.project === p.name ? 'page' : undefined} onClick={() => void video.open(p.name)}>
                <span className="list-name">{p.name}</span>
                <RowMark changed={changed?.has(p.name) === true} changedTitle="Cut changed by Mobius in its last turn" />
                <span className="list-count">{p.clips.length || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {video.project && (
        <section className="video-footage" aria-label="Footage">
          <div className="code-tree-head"><span>Footage</span><button type="button" className="btn" onClick={() => void video.showFolder()}>Show folder</button></div>
          {video.clips.length === 0 && <p className="photo-drop-hint">Copy clips into the project’s folder, or drop them on the window.</p>}
          <ul role="list">
            {video.clips.map((c) => (
              <li key={c.name} className="video-clip">
                <span className="video-clip-name">{c.name}</span>
                <span className="video-clip-len">{video.lengthOf(c.name) ? timecode(video.lengthOf(c.name)!) : ''}</span>
                <button type="button" className="strip-btn" aria-label={`Add ${c.name} to the cut`} title="Add to the cut" onClick={() => addShot(c.name)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <FromMobius items={video.projects.filter((p) => changed?.has(p.name)).map((p) => ({ key: p.name, name: p.name, current: video.project === p.name, onOpen: () => void video.open(p.name) }))} />
    </aside>
  );
}

/** The cut: a viewer that plays its shots in order, the shots as a timeline, and the chosen shot to trim. */
export function VideoEditor({ video, review }: { video: VideoState; review?: { conversation: string } | null }) {
  const player = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const { cut } = video;
  const file = video.project ? `video/${video.project}/cut.json` : null;
  const { before, keep, discard } = useFileReview(review, file, video.base);
  const changed = useMemo(() => (before === undefined ? new Set<string>() : changedShots(before === null ? null : parseCut(before), cut)), [before, cut]);
  const total = cutLength(cut);
  const shot: Shot | undefined = cut.shots[index];

  // Show a shot at a time in its clip.
  const cue = (i: number, clipTime: number, play: boolean) => {
    const el = player.current;
    const s = cut.shots[i];
    if (!el || !s) return;
    setIndex(i);
    void video.playable(s.clip).then((src) => {
      const go = () => { el.currentTime = clipTime; if (play) void el.play().catch(() => setPlaying(false)); };
      if (el.getAttribute('src') === src && el.readyState >= 1) { go(); return; }
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
      el.addEventListener('loadedmetadata', go, { once: true });
    });
  };
  useEffect(() => { setIndex(0); setT(0); setPlaying(false); player.current?.pause(); if (cut.shots[0]) cue(0, cut.shots[0].in, false); }, [video.project]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!playing && cut.shots.length > 0) { const at = locate(cut, t); if (at) cue(at.index, at.clipTime, false); } }, [cut]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTime = () => {
    const el = player.current;
    if (!el || !shot) return;
    setT(shotStart(cut, index) + Math.max(0, el.currentTime - shot.in));
    if (el.currentTime >= shot.out - 0.04) {
      if (index + 1 < cut.shots.length) cue(index + 1, cut.shots[index + 1]!.in, playing);
      else { el.pause(); setPlaying(false); }
    }
  };
  const toggle = () => {
    const el = player.current;
    if (!el || !shot) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    setPlaying(true);
    const at = t >= total - 0.05 ? { index: 0, clipTime: cut.shots[0]!.in } : locate(cut, t);
    if (at) cue(at.index, at.clipTime, true);
  };
  const seek = (to: number) => { const at = locate(cut, Math.max(0, Math.min(total, to))); setT(to); if (at) cue(at.index, at.clipTime, playing); };
  const setShot = (id: string, fn: (s: Shot) => void) => video.change({ ...cut, shots: cut.shots.map((s) => { if (s.id !== id) return s; const n = { ...s }; fn(n); n.out = Math.max(n.in + 0.1, n.out); return n; }) });
  const move = (id: string, by: number) => {
    const i = cut.shots.findIndex((s) => s.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= cut.shots.length) return;
    const shots = [...cut.shots];
    [shots[i], shots[j]] = [shots[j]!, shots[i]!];
    video.change({ ...cut, shots });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => /^(video|audio)\//.test(f.type));
    if (files.length) void video.addFiles(files);
  };

  if (!video.available) return <section className="video-page empty" aria-label="Video"><EmptyState app="video" title="Video is not available here" /></section>;
  if (!video.project) return <section className="video-page empty" aria-label="Video"><EmptyState app="video" label="No project open" title={video.projects.length ? 'No project open' : 'No projects yet'} line="A project is a folder of clips and its cut. The clips are never changed." action={{ label: 'New project', run: () => void video.createProject('Project') }} /></section>;
  const sel = cut.shots.find((s) => s.id === selected) ?? null;
  const pxPerSec = total > 0 ? Math.max(14, Math.min(90, 900 / total)) : 40;
  const names = [...changed].map((id) => { const i = cut.shots.findIndex((s) => s.id === id); return i >= 0 ? `shot ${i + 1}` : id; });
  return (
    <section className="video-page" aria-label="Video" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="video-top">
        <div className="video-viewer">
          <video ref={player} className="video-player" aria-label="Viewer" playsInline onTimeUpdate={onTime} onEnded={onTime} onError={() => setUnplayable(true)} onLoadedMetadata={() => setUnplayable(false)} />
          {unplayable && <p className="video-empty" role="status">This clip cannot be played in this window. Its file is untouched, and the cut still works.</p>}
          {shot?.title && <div className="video-title">{shot.title}</div>}
          {cut.shots.length === 0 && <p className="video-empty">Add clips from Footage to start the cut, or ask Mobius for a rough cut.</p>}
        </div>
        <aside className="video-inspector" aria-label="Shot">
          {sel ? (
            <>
              <div className="design-panel-title">{`Shot ${cut.shots.indexOf(sel) + 1} · ${sel.clip}`}</div>
              <div className="design-grid">
                <label className="design-field"><span>In</span><input aria-label="In" type="number" step={0.1} min={0} value={sel.in} onChange={(e) => setShot(sel.id, (s) => { s.in = Math.max(0, Number(e.target.value) || 0); })} /></label>
                <label className="design-field"><span>Out</span><input aria-label="Out" type="number" step={0.1} min={0} value={sel.out} onChange={(e) => setShot(sel.id, (s) => { s.out = Math.min(video.lengthOf(s.clip) || Infinity, Number(e.target.value) || 0); })} /></label>
              </div>
              <div className="design-row">
                <button type="button" className="btn" onClick={() => { const el = player.current; if (el && cut.shots[index]?.id === sel.id) setShot(sel.id, (s) => { s.in = Math.round(el.currentTime * 100) / 100; }); }}>Set in here</button>
                <button type="button" className="btn" onClick={() => { const el = player.current; if (el && cut.shots[index]?.id === sel.id) setShot(sel.id, (s) => { s.out = Math.round(el.currentTime * 100) / 100; }); }}>Set out here</button>
              </div>
              <label className="design-text"><span>Title</span><input aria-label="Title" value={sel.title} maxLength={200} placeholder="None" onChange={(e) => setShot(sel.id, (s) => { s.title = e.target.value; })} /></label>
              <div className="design-row">
                <button type="button" className="btn" onClick={() => move(sel.id, -1)}>Earlier</button>
                <button type="button" className="btn" onClick={() => move(sel.id, 1)}>Later</button>
              </div>
              <button type="button" className="btn danger" onClick={() => { video.change({ ...cut, shots: cut.shots.filter((s) => s.id !== sel.id) }); setSelected(null); }}>Remove shot</button>
            </>
          ) : (
            <p className="design-hint">Choose a shot in the timeline to trim it, title it or move it. The clips themselves are never changed.</p>
          )}
        </aside>
      </div>
      <div className="video-transport" role="toolbar" aria-label="Transport">
        <button type="button" className="btn primary" disabled={!shot} onClick={toggle}>{playing ? 'Pause' : 'Play'}</button>
        <span className="video-time" aria-label="Time">{`${timecode(t)} / ${timecode(total)}`}</span>
        <span className="photo-meta">{`${cut.shots.length} ${cut.shots.length === 1 ? 'shot' : 'shots'}${video.saved ? '' : ' · Saving…'}`}</span>
      </div>
      {video.message && <p className="tasks-message" role="alert">{video.message}</p>}
      {changed.size > 0 && (
        <div className="studio-review" role="group" aria-label="Mobius's change">
          <span className="review-dot" aria-hidden="true" />
          <span>{`Mobius ${before === null ? 'made the cut' : `changed ${names.join(', ')}`}; dashed below. The clips are untouched.`}{review && <WhyThis conversation={review.conversation} />}</span>
          <ReviewActions onKeep={keep} onDiscard={discard} />
        </div>
      )}
      <div className="video-timeline" role="listbox" aria-label="Timeline" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
        <div className="video-track" style={{ width: Math.max(1, total) * pxPerSec }}>
          {cut.shots.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={selected === s.id}
              aria-label={`Shot ${i + 1}: ${s.clip}, ${timecode(shotLength(s))}${s.title ? `, titled ${s.title}` : ''}`}
              className="video-shot"
              data-proposed={changed.has(s.id) || undefined}
              data-playing={index === i || undefined}
              style={{ width: Math.max(18, shotLength(s) * pxPerSec - 2) }}
              onClick={() => { setSelected(s.id); seek(shotStart(cut, i)); }}
            >
              <span className="video-shot-name">{s.title || s.clip}</span>
              <span className="video-shot-len">{timecode(shotLength(s))}</span>
            </button>
          ))}
          <span className="studio-playhead" style={{ left: t * pxPerSec }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

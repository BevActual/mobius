import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type VideoProject } from '@mobius/shared';
import { mediaUrl, parseCut, writeCut, type Cut } from './cut-format';

const LAST_KEY = 'mobius.video.last';
const SAVE_DELAY_MS = 400;

/** The Video app's state: projects, the open one's cut as changed here (saved shortly after), and its clips' lengths. */
export function useVideo() {
  const api = window.mobius.video;
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [cut, setCut] = useState<Cut>({ version: 1, shots: [] });
  const [base, setBase] = useState<number | null>(null);
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState('');
  /** Each clip's length in seconds, read from the file by the player. */
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const live = useRef({ project, cut, base, saved });
  live.current = { project, cut, base, saved };
  const timer = useRef<number | undefined>(undefined);
  const url = useCallback((clip: string) => (project ? mediaUrl(project, clip, window.mobius.platform) : ''), [project]);

  const refresh = useCallback(async () => {
    const list = await api?.projects();
    const ok = list && !isNotesFailure(list) ? list : [];
    setProjects(ok);
    return ok;
  }, [api]);

  const loadCut = useCallback(async (name: string) => {
    const got = await api?.readCut(name);
    if (!got || isNotesFailure(got)) { if (got) setMessage(got.message); return; }
    setCut(parseCut(got.text));
    setBase(got.modified);
    setSaved(true);
  }, [api]);

  const open = useCallback(async (name: string) => {
    setProject(name);
    setMessage('');
    try { window.localStorage.setItem(LAST_KEY, name); } catch { /* Not kept. */ }
    await loadCut(name);
  }, [loadCut]);

  // Clip lengths, read once per clip from the file's own header.
  const clips = projects.find((p) => p.name === project)?.clips ?? [];
  useEffect(() => {
    if (!project) return;
    for (const c of clips) {
      const key = `${project}/${c.name}`;
      if (lengths[key] !== undefined) continue;
      const el = document.createElement(c.kind === 'audio' ? 'audio' : 'video');
      el.preload = 'metadata';
      el.onloadedmetadata = () => { setLengths((was) => ({ ...was, [key]: Math.round(el.duration * 100) / 100 })); el.removeAttribute('src'); };
      el.onerror = () => setLengths((was) => ({ ...was, [key]: 0 }));
      el.src = url(c.name);
    }
  }, [project, clips.map((c) => c.name).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    const now = live.current;
    if (!api || !now.project) return;
    const done = await api.saveCut(now.project, writeCut(now.cut), now.base);
    if (isNotesFailure(done)) { setMessage(done.conflict ? 'The cut changed elsewhere. Open the project again to see it.' : done.message); return; }
    setBase(done.modified);
    if (live.current.cut === now.cut) setSaved(true);
  }, [api]);

  const change = useCallback((next: Cut) => {
    setCut(next);
    setSaved(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  useEffect(() => {
    void refresh().then((list) => {
      if (live.current.project) return;
      let last: string | null = null;
      try { last = window.localStorage.getItem(LAST_KEY); } catch { /* None. */ }
      const first = list.find((p) => p.name === last)?.name ?? list[0]?.name;
      if (first) void open(first);
    });
    return api?.onChanged((c) => {
      void refresh();
      const now = live.current;
      if (now.project && (c.project === null || c.project === now.project) && c.by !== 'person' && now.saved) void loadCut(now.project);
    });
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const createProject = useCallback(async (name: string) => {
    const made = await api?.createProject(name);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    await refresh();
    await open(made.name);
    return made.name;
  }, [api, refresh, open]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    const now = live.current;
    if (!api || !now.project) return;
    for (const f of files) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(f);
      }).catch(() => null);
      if (data === null) continue;
      const added = await api.addClip(now.project, f.name, data);
      if (isNotesFailure(added)) setMessage(added.message);
    }
    await refresh();
  }, [api, refresh]);

  const lengthOf = useCallback((clip: string) => (project ? lengths[`${project}/${clip}`] : undefined), [project, lengths]);
  return { available: api !== undefined, projects, project, clips, cut, base, change, saved, message, setMessage, open, refresh, reload: () => (project ? loadCut(project) : Promise.resolve()), createProject, addFiles, url, lengthOf, showFolder: () => (project ? api?.showFolder(project) : undefined) };
}
export type VideoState = ReturnType<typeof useVideo>;

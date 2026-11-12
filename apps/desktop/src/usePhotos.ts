import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type PhotoAlbum } from '@mobius/shared';
import { parseEdits, writeEdits, type PhotoEdits } from './photo-edit';
import { emptyHistory, recorded, redone, undone, type History } from './photo-view';

const LAST_KEY = 'mobius.photos.last';
const SAVE_DELAY_MS = 400;
export interface OpenPhoto { path: string; dataUrl: string; base: number | null }

/** The Photo app's state: albums, the open photo, its edits as changed here (saved shortly after), and what it looks like. */
export function usePhotos(active = true) {
  const api = window.mobius.photos;
  const [albums, setAlbums] = useState<PhotoAlbum[]>([]);
  const [open, setOpen] = useState<OpenPhoto | null>(null);
  const [edits, setEdits] = useState<PhotoEdits>({ version: 1, adjustments: [] });
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  /** The photo in words (size, average colours), for the agent: it reads the edits but cannot see the picture. */
  const [described, setDescribed] = useState('');
  /** The album shown, and whether its photos are shown as a grid rather than one photo. */
  const [album, setAlbum] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  /** Undo for each photo's edits, kept while the app is open. */
  const histories = useRef(new Map<string, History<PhotoEdits>>());
  const [, setStamp] = useState(0);
  const live = useRef({ open, edits, saved });
  live.current = { open, edits, saved };
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const list = await api?.albums();
    const ok = list && !isNotesFailure(list) ? list : [];
    setAlbums(ok);
    return ok;
  }, [api]);

  const load = useCallback(async (path: string, keepSelection = false) => {
    if (!api) return false;
    const got = await api.read(path);
    if (isNotesFailure(got)) { setMessage(got.message); return false; }
    setOpen({ path, dataUrl: got.dataUrl, base: got.editsModified });
    setAlbum(path.split('/')[0] ?? null);
    const parsed = parseEdits(got.edits);
    setEdits(parsed);
    setSaved(true);
    setMessage('');
    if (!keepSelection) setSelected(parsed.adjustments[parsed.adjustments.length - 1]?.id ?? null);
    try { window.localStorage.setItem(LAST_KEY, path); } catch { /* Not kept. */ }
    return true;
  }, [api]);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    const { open: o, edits: e } = live.current;
    if (!api || !o) return true;
    const done = await api.saveEdits(o.path, writeEdits(e), o.base);
    if (isNotesFailure(done)) {
      setMessage(done.conflict ? 'These edits changed elsewhere. Open the photo again to see them.' : done.message);
      return false;
    }
    setOpen((cur) => (cur && cur.path === o.path ? { ...cur, base: done.editsModified } : cur));
    if (live.current.edits === e) setSaved(true);
    return true;
  }, [api]);

  const schedule = useCallback((next: PhotoEdits) => {
    setEdits(next);
    setSaved(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  /** A change made here; `tag` joins changes close together into one undo (a slider dragged, a name typed). */
  const change = useCallback((next: PhotoEdits, tag = '') => {
    const o = live.current.open;
    if (writeEdits(next) === writeEdits(live.current.edits)) return;
    if (o) histories.current.set(o.path, recorded(histories.current.get(o.path) ?? emptyHistory(), live.current.edits, tag, Date.now()));
    schedule(next);
    setStamp((n) => n + 1);
  }, [schedule]);
  const step = useCallback((back: boolean) => {
    const o = live.current.open;
    if (!o) return false;
    const h = histories.current.get(o.path) ?? emptyHistory<PhotoEdits>();
    const got = back ? undone(h, live.current.edits) : redone(h, live.current.edits);
    if (!got) return false;
    histories.current.set(o.path, got.history);
    schedule(got.value);
    setStamp((n) => n + 1);
    return true;
  }, [schedule]);
  const here = open ? histories.current.get(open.path) : undefined;

  const openPhoto = useCallback(async (path: string) => {
    setBrowsing(false);
    if (live.current.open?.path === path) return;
    if (!live.current.saved) await save();
    await load(path);
  }, [load, save]);

  useEffect(() => {
    // Nothing is read until the app is first opened (Abilities: apps load when they are used).
    if (!active) return undefined;
    void refresh().then((list) => {
      if (live.current.open) return;
      let last: string | null = null;
      try { last = window.localStorage.getItem(LAST_KEY); } catch { /* None. */ }
      const all = list.flatMap((a) => a.photos.map((p) => p.path));
      const first = last && all.includes(last) ? last : all[0];
      if (first) void load(first);
    });
    return api?.onChanged((c) => {
      void refresh();
      const now = live.current;
      if (now.open && (c.path === null || c.path === now.open.path) && c.by !== 'person' && now.saved) void load(now.open.path, true);
    });
  }, [active, api]); // eslint-disable-line react-hooks/exhaustive-deps

  const createAlbum = useCallback(async (name: string) => {
    const made = await api?.createAlbum(name);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    await refresh();
    return made.name;
  }, [api, refresh]);

  const addFiles = useCallback(async (album: string, files: readonly File[]) => {
    if (!api) return;
    let last: string | null = null;
    for (const f of files) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(f);
      }).catch(() => null);
      if (data === null) continue;
      const added = await api.add(album, f.name, data);
      if (isNotesFailure(added)) setMessage(added.message); else last = added.path;
    }
    await refresh();
    if (last) await openPhoto(last);
  }, [api, refresh, openPhoto]);

  /** Saves a new picture beside the open photo, or beside `path` when it is exported from the album's grid. */
  const exportPicture = useCallback(async (jpegBase64: string, path?: string) => {
    const from = path ?? live.current.open?.path;
    if (!api || !from) return null;
    const done = await api.export(from, jpegBase64);
    if (isNotesFailure(done)) { setMessage(done.message); return null; }
    await refresh();
    return done.path;
  }, [api, refresh]);

  const showAlbum = useCallback((name: string) => { setAlbum(name); setBrowsing(true); }, []);

  return { available: api !== undefined, albums, album: album ?? albums[0]?.name ?? null, browsing, showAlbum, setBrowsing, undo: () => step(true), redo: () => step(false), canUndo: (here?.past.length ?? 0) > 0, canRedo: (here?.future.length ?? 0) > 0, read: (path: string) => api?.read(path), open, edits, change, saved, message, setMessage, selected, setSelected, described, setDescribed, openPhoto, reload: () => (live.current.open ? load(live.current.open.path, true) : Promise.resolve(false)), createAlbum, addFiles, exportPicture, refresh };
}
export type PhotosState = ReturnType<typeof usePhotos>;

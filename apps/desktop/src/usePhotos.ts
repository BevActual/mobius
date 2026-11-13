import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type PhotoAlbum, type PhotoInfo } from '@mobius/shared';
import { parseEdits, writeEdits, type PhotoEdits } from './photo-edit';
import { emptyHistory, recorded, redone, undone, type History } from './photo-view';

const LAST_KEY = 'mobius.photos.last';
const SAVE_DELAY_MS = 400;
/** The album shown when Recently Deleted is open: no real album's name starts with a dot. */
export const RECENTLY_DELETED = '.deleted';
export type DeletedPhoto = PhotoInfo & { album: string };
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

  // Managing the library: renaming, moving and deleting photos and albums. Deleted photos wait in Recently Deleted.
  const [deleted, setDeleted] = useState<DeletedPhoto[]>([]);
  const refreshDeleted = useCallback(async () => {
    const list = await api?.deleted?.().catch(() => null);
    setDeleted(list && !isNotesFailure(list) ? list : []);
  }, [api]);
  useEffect(() => { if (active) void refreshDeleted(); }, [active, refreshDeleted]);
  const failed = (r: unknown): r is { message: string } => { if (r && isNotesFailure(r as never)) { setMessage((r as { message: string }).message); return true; } return false; };
  /** A photo now at `to` instead of `from`: the open photo follows it, keeping its undo. */
  const relocated = useCallback(async (from: string, to: string) => {
    const h = histories.current.get(from);
    if (h) { histories.current.set(to, h); histories.current.delete(from); }
    if (live.current.open?.path === from) await load(to, true);
  }, [load]);
  const settleOpen = useCallback(async (path: string) => {
    if (live.current.open?.path === path && !live.current.saved) await save();
  }, [save]);
  const renamePhoto = useCallback(async (path: string, name: string) => {
    if (!api?.rename) return null;
    await settleOpen(path);
    const r = await api.rename(path, name);
    if (failed(r)) return null;
    await relocated(path, r.path);
    await refresh();
    return r.path;
  }, [api, refresh, relocated, settleOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const movePhoto = useCallback(async (path: string, to: string) => {
    if (!api?.move) return null;
    await settleOpen(path);
    const r = await api.move(path, to);
    if (failed(r)) return null;
    await relocated(path, r.path);
    await refresh();
    setMessage(`Moved to ${to}.`);
    return r.path;
  }, [api, refresh, relocated, settleOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const deletePhoto = useCallback(async (path: string) => {
    if (!api?.delete) return false;
    await settleOpen(path);
    const r = await api.delete(path);
    if (failed(r)) return false;
    histories.current.delete(path);
    if (live.current.open?.path === path) { setOpen(null); setBrowsing(true); }
    await Promise.all([refresh(), refreshDeleted()]);
    return true;
  }, [api, refresh, refreshDeleted, settleOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const recoverPhoto = useCallback(async (path: string) => {
    if (!api?.recover) return null;
    const r = await api.recover(path);
    if (failed(r)) return null;
    await Promise.all([refresh(), refreshDeleted()]);
    setMessage(`Put back in ${r.path.split('/')[0]}.`);
    return r.path;
  }, [api, refresh, refreshDeleted]); // eslint-disable-line react-hooks/exhaustive-deps
  const emptyDeleted = useCallback(async () => {
    if (!api?.emptyDeleted) return;
    const r = await api.emptyDeleted();
    if (failed(r)) return;
    await refreshDeleted();
  }, [api, refreshDeleted]); // eslint-disable-line react-hooks/exhaustive-deps
  const renameAlbum = useCallback(async (from: string, name: string) => {
    if (!api?.renameAlbum) return null;
    const o = live.current.open;
    if (o && o.path.startsWith(`${from}/`) && !live.current.saved) await save();
    const r = await api.renameAlbum(from, name);
    if (failed(r)) return null;
    for (const [k, h] of [...histories.current]) if (k.startsWith(`${from}/`)) { histories.current.set(`${r.name}/${k.slice(from.length + 1)}`, h); histories.current.delete(k); }
    if (o && o.path.startsWith(`${from}/`)) await load(`${r.name}/${o.path.slice(from.length + 1)}`, true);
    setAlbum((cur) => (cur === from ? r.name : cur));
    await refresh();
    return r.name;
  }, [api, load, refresh, save]); // eslint-disable-line react-hooks/exhaustive-deps
  const deleteAlbum = useCallback(async (name: string) => {
    if (!api?.deleteAlbum) return false;
    const o = live.current.open;
    if (o && o.path.startsWith(`${name}/`) && !live.current.saved) await save();
    const r = await api.deleteAlbum(name);
    if (failed(r)) return false;
    if (o && o.path.startsWith(`${name}/`)) setOpen(null);
    const list = await refresh();
    await refreshDeleted();
    setAlbum((cur) => (cur === name ? (list[0]?.name ?? null) : cur));
    setBrowsing(true);
    if (r.deleted > 0) setMessage(`${r.deleted === 1 ? '1 photo' : `${r.deleted} photos`} moved to Recently Deleted.`);
    return true;
  }, [api, refresh, refreshDeleted, save]); // eslint-disable-line react-hooks/exhaustive-deps
  const readDeleted = (path: string) => api?.readDeleted?.(path);

  return { available: api !== undefined, albums, album: album ?? albums[0]?.name ?? null, browsing, showAlbum, setBrowsing, undo: () => step(true), redo: () => step(false), canUndo: (here?.past.length ?? 0) > 0, canRedo: (here?.future.length ?? 0) > 0, read: (path: string) => api?.read(path), open, edits, change, saved, message, setMessage, selected, setSelected, described, setDescribed, openPhoto, reload: () => (live.current.open ? load(live.current.open.path, true) : Promise.resolve(false)), createAlbum, addFiles, exportPicture, refresh, deleted, refreshDeleted, readDeleted, renamePhoto, movePhoto, deletePhoto, recoverPhoto, emptyDeleted, renameAlbum, deleteAlbum };
}
export type PhotosState = ReturnType<typeof usePhotos>;

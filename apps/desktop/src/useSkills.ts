import { useCallback, useEffect, useRef, useState } from 'react';
import { isNotesFailure, type SkillContent, type SkillInfo } from '@mobius/shared';

const SAVE_DELAY_MS = 500;

/** The Skills app's state: the skills, the open one as typed (saved shortly after), and its versions. */
export function useSkills() {
  const api = window.mobius.skills;
  const [list, setList] = useState<SkillInfo[]>([]);
  const [open, setOpen] = useState<SkillContent | null>(null);
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState('');
  const live = useRef({ open, text, saved });
  live.current = { open, text, saved };
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const got = await api?.list();
    const ok = got && !isNotesFailure(got) ? got : [];
    setList(ok);
    return ok;
  }, [api]);

  // Typing bumps this. A read that was already on its way when the person typed (the new skill opening, a save's
  // re-read) must not put the older text back over theirs: it brings the skill's newest version, and keeps their words.
  const edits = useRef(0);
  const load = useCallback(async (name: string, onlyIfNoneOpen = false) => {
    const at = edits.current;
    const got = await api?.read(name);
    if (!got || isNotesFailure(got)) { if (got) setMessage(got.message); return false; }
    // The first skill shown on opening gives way to one opened (or made) while it was being read.
    if (onlyIfNoneOpen && live.current.open) return false;
    if (edits.current !== at && live.current.open?.name === name) { setOpen(got); return true; }
    setOpen(got);
    setText(got.text);
    setSaved(true);
    setMessage('');
    return true;
  }, [api]);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    const now = live.current;
    if (!api || !now.open) return;
    const done = await api.save(now.open.name, now.text, now.open.modified);
    if (isNotesFailure(done)) { setMessage(done.conflict ? 'This skill changed elsewhere. Open it again to see the change.' : done.message); return; }
    if (live.current.text === now.text) setSaved(true);
    await load(now.open.name);
    void refresh();
  }, [api, load, refresh]);

  const edit = useCallback((next: string) => {
    edits.current += 1;
    setText(next);
    setSaved(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  const openSkill = useCallback(async (name: string) => {
    if (!live.current.saved) await save();
    await load(name);
  }, [load, save]);

  useEffect(() => {
    void refresh().then((l) => { if (!live.current.open && l[0]) void load(l[0].name, true); });
    return api?.onChanged((c) => {
      void refresh();
      const now = live.current;
      if (now.open && (c.name === null || c.name === now.open.name) && c.by !== 'person' && now.saved) void load(now.open.name);
    });
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useCallback(async (title: string, description: string) => {
    const made = await api?.create(title, description);
    if (!made || isNotesFailure(made)) { if (made) setMessage(made.message); return null; }
    await refresh();
    await load(made.name);
    return made.name;
  }, [api, refresh, load]);

  const restore = useCallback(async (version: number) => {
    const now = live.current;
    if (!api || !now.open) return;
    const done = await api.restore(now.open.name, version);
    if (isNotesFailure(done)) { setMessage(done.message); return; }
    await load(now.open.name);
    void refresh();
  }, [api, load, refresh]);

  const remove = useCallback(async () => {
    const now = live.current;
    if (!api || !now.open) return;
    const done = await api.remove(now.open.name);
    if (isNotesFailure(done)) { setMessage(done.message); return; }
    setOpen(null);
    setText('');
    const l = await refresh();
    if (l[0]) await load(l[0].name);
  }, [api, refresh, load]);

  const close = useCallback(() => { setOpen(null); setText(''); }, []);

  return { available: api !== undefined, close, list, open, text, edit, saved, message, openSkill, reload: () => (live.current.open ? load(live.current.open.name) : Promise.resolve(false)), create, restore, remove, names: list.map((s) => s.name) };
}
export type SkillsState = ReturnType<typeof useSkills>;

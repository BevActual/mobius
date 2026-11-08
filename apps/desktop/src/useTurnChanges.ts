import { useCallback, useEffect, useState } from 'react';

/** What the last agent turn changed, as note page paths and task list names, so Notes and Tasks can mark them. */
export interface TurnMarks { notes: ReadonlySet<string>; lists: ReadonlySet<string>; docs: ReadonlySet<string>; sheets: ReadonlySet<string>; slides: ReadonlySet<string>; /** `project/path` of code files. */ code: ReadonlySet<string>; designs: ReadonlySet<string>; boards: ReadonlySet<string>; research: ReadonlySet<string>; /** `album/photo` whose edits changed. */ photos: ReadonlySet<string>; songs: ReadonlySet<string>; /** Video projects whose cut changed. */ video: ReadonlySet<string>; skills: ReadonlySet<string> }
const NONE: TurnMarks = { notes: new Set(), lists: new Set(), docs: new Set(), sheets: new Set(), slides: new Set(), code: new Set(), designs: new Set(), boards: new Set(), research: new Set(), photos: new Set(), songs: new Set(), video: new Set(), skills: new Set() };

export function marksOf(files: readonly string[]): TurnMarks {
  const notes = new Set<string>();
  const lists = new Set<string>();
  const docs = new Set<string>();
  const sheets = new Set<string>();
  const slides = new Set<string>();
  const code = new Set<string>();
  const designs = new Set<string>();
  const boards = new Set<string>();
  const research = new Set<string>();
  const photos = new Set<string>();
  const songs = new Set<string>();
  const video = new Set<string>();
  const skills = new Set<string>();
  for (const file of files) {
    if (file.startsWith('notes/')) notes.add(file.slice('notes/'.length));
    else if (file.startsWith('docs/')) docs.add(file.slice('docs/'.length));
    else if (file.startsWith('slides/')) slides.add(file.slice('slides/'.length));
    else if (file.startsWith('sheets/')) sheets.add(file.slice('sheets/'.length).split('/')[0]!);
    else if (file.startsWith('skills/')) skills.add(file.slice('skills/'.length).split('/')[0]!);
    else if (file.startsWith('video/')) video.add(file.slice('video/'.length).split('/')[0]!);
    else if (file.startsWith('studio/')) songs.add(file.slice('studio/'.length));
    else if (file.startsWith('photos/')) photos.add(file.slice('photos/'.length).replace(/\.edits\.json$/, ''));
    else if (file.startsWith('designs/')) designs.add(file.slice('designs/'.length));
    else if (file.startsWith('boards/')) boards.add(file.slice('boards/'.length));
    else if (file.startsWith('research/')) research.add(file.slice('research/'.length));
    else if (file.startsWith('code/')) code.add(file.slice('code/'.length));
    else if (file.startsWith('tasks/') && file.endsWith('.md')) lists.add(file.slice('tasks/'.length, -'.md'.length));
  }
  return { notes, lists, docs, sheets, slides, code, designs, boards, research, photos, songs, video, skills };
}

/** Read when a turn ends, when another conversation is shown, and after anything is put back. */
export function useTurnChanges(conversation: string, busy: boolean): TurnMarks {
  const [marks, setMarks] = useState<TurnMarks>(NONE);
  const load = useCallback(async () => {
    const result = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
    setMarks(result && 'files' in result ? marksOf(result.files) : NONE);
  }, [conversation]);
  useEffect(() => { if (!busy) void load(); }, [busy, load]);
  useEffect(() => {
    const again = (change: { by: string }) => { if (change.by === 'person' || change.by === 'undo') void load(); };
    const offNotes = window.mobius.notes?.onChanged(again);
    const offTasks = window.mobius.tasks?.onChanged(again);
    const offDocs = window.mobius.docs?.onChanged(again);
    const offSheets = window.mobius.sheets?.onChanged(again);
    const offSlides = window.mobius.slides?.onChanged(again);
    const offCode = window.mobius.code?.onChanged(again);
    const offDesigns = window.mobius.designs?.onChanged(again);
    const offBoards = window.mobius.boards?.onChanged(again);
    const offResearch = window.mobius.research?.onChanged(again);
    const offPhotos = window.mobius.photos?.onChanged(again);
    const offSongs = window.mobius.songs?.onChanged(again);
    const offVideo = window.mobius.video?.onChanged(again);
    const offSkills = window.mobius.skills?.onChanged(again);
    return () => { offSkills?.(); offVideo?.(); offSongs?.(); offPhotos?.(); offNotes?.(); offTasks?.(); offDocs?.(); offSheets?.(); offSlides?.(); offCode?.(); offDesigns?.(); offBoards?.(); offResearch?.(); };
  }, [load]);
  return marks;
}

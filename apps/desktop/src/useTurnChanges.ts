import { useCallback, useEffect, useState, useRef } from 'react';
import { KEPT_EVENT, fileKept, keptTurns, turnId } from './ReviewStrip';

/** What the last agent turn changed, as note page paths and task list names, so Notes and Tasks can mark them. */
export interface TurnMarks { /** The changed workspace files still waiting for Keep. */ files: readonly string[]; notes: ReadonlySet<string>; lists: ReadonlySet<string>; docs: ReadonlySet<string>; sheets: ReadonlySet<string>; slides: ReadonlySet<string>; /** `project/path` of code files. */ code: ReadonlySet<string>; designs: ReadonlySet<string>; boards: ReadonlySet<string>; research: ReadonlySet<string>; reading: ReadonlySet<string>; /** Database names. */ databases: ReadonlySet<string>; /** `album/photo` whose edits changed. */ photos: ReadonlySet<string>; songs: ReadonlySet<string>; /** Video projects whose cut changed. */ video: ReadonlySet<string>; skills: ReadonlySet<string>; /** Calendar app: calendar names whose .ics file changed. */ calendars: ReadonlySet<string> }
const NONE: TurnMarks = { files: [], notes: new Set(), lists: new Set(), docs: new Set(), sheets: new Set(), slides: new Set(), code: new Set(), designs: new Set(), boards: new Set(), research: new Set(), reading: new Set(), databases: new Set(), photos: new Set(), songs: new Set(), video: new Set(), skills: new Set(), calendars: new Set() };

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
  const reading = new Set<string>();
  const databases = new Set<string>();
  const photos = new Set<string>();
  const songs = new Set<string>();
  const video = new Set<string>();
  const skills = new Set<string>();
  const calendars = new Set<string>(); // Calendar app
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
    else if (file.startsWith('reading/')) reading.add(file.slice('reading/'.length));
    else if (file.startsWith('databases/') && file.endsWith('.sqlite')) databases.add(file.slice('databases/'.length, -'.sqlite'.length));
    else if (file.startsWith('code/')) code.add(file.slice('code/'.length));
    else if (file.startsWith('calendar/') && file.endsWith('.ics')) calendars.add(file.slice('calendar/'.length, -'.ics'.length)); // Calendar app
    else if (file.startsWith('tasks/') && file.endsWith('.md')) lists.add(file.slice('tasks/'.length, -'.md'.length));
  }
  return { files: [...files], notes, lists, docs, sheets, slides, code, designs, boards, research, reading, databases, photos, songs, video, skills, calendars };
}

/** Read when a turn ends, when another conversation is shown, and after anything is put back. While the turn runs, read
 * again after each call it finishes (`progress` counts them), so a change is drawn when it is made, not at the end. */
export function useTurnChanges(conversation: string, busy: boolean, progress = 0): TurnMarks {
  const [marks, setMarks] = useState<TurnMarks>(NONE);
  // Only the latest read counts: one made before the turn (on opening, say) can come back after the one made when it
  // ended on a busy computer, and would take every dashed edge away (canvas.spec:139 once saw that).
  const reads = useRef(0);
  const load = useCallback(async () => {
    const n = ++reads.current;
    const asked = performance.now();
    const result = await window.mobius.changes?.lastTurn(conversation).catch(() => null);
    // Said on the console (the e2e logs print it), so a change that never shows dashed can be traced to this read.
    console.log(`[mobius] marks: ${result && 'files' in result ? `${result.files.length} file(s) changed` : 'no turn'} in ${Math.round(performance.now() - asked)} ms${n !== reads.current ? ', a newer read is coming' : ''}`);
    if (n !== reads.current) return;
    // A kept turn's changes are the person's now: they lose their dashed edge.
    const id = result && 'files' in result ? turnId(conversation, result.checkpoint) : null;
    // One app's Keep takes only its own files' dashed edges away.
    setMarks(result && 'files' in result && !(id && keptTurns().includes(id)) ? marksOf(result.files.filter((f) => !(id && fileKept(id, f)))) : NONE);
  }, [conversation]);
  useEffect(() => { if (!busy) void load(); }, [busy, load]);
  // A burst of calls is one read, a moment after the last of them.
  useEffect(() => {
    if (!busy || progress === 0) return;
    const later = setTimeout(() => void load(), 150);
    return () => clearTimeout(later);
  }, [busy, progress, load]);
  useEffect(() => {
    const kept = () => void load();
    window.addEventListener(KEPT_EVENT, kept);
    return () => window.removeEventListener(KEPT_EVENT, kept);
  }, [load]);
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
    const offReading = window.mobius.reading?.onChanged(again);
    const offDatabases = window.mobius.databases?.onChanged(again);
    const offPhotos = window.mobius.photos?.onChanged(again);
    const offSongs = window.mobius.songs?.onChanged(again);
    const offVideo = window.mobius.video?.onChanged(again);
    const offSkills = window.mobius.skills?.onChanged(again);
    return () => { offSkills?.(); offVideo?.(); offSongs?.(); offPhotos?.(); offNotes?.(); offTasks?.(); offDocs?.(); offSheets?.(); offSlides?.(); offCode?.(); offDesigns?.(); offBoards?.(); offResearch?.(); offReading?.(); offDatabases?.(); };
  }, [load]);
  return marks;
}

import { useEffect, useState } from 'react';
import type { ScheduleDraft, ScheduleInfo } from '@mobius/shared';
import { Row } from './primitives';
import { settingPath } from './manifest';
import type { SectionProps } from './sections';

const DAYS = [
  { n: 1, short: 'Mon', long: 'Monday' }, { n: 2, short: 'Tue', long: 'Tuesday' }, { n: 3, short: 'Wed', long: 'Wednesday' },
  { n: 4, short: 'Thu', long: 'Thursday' }, { n: 5, short: 'Fri', long: 'Friday' }, { n: 6, short: 'Sat', long: 'Saturday' }, { n: 7, short: 'Sun', long: 'Sunday' },
];
const EMPTY: ScheduleDraft = { title: '', prompt: '', time: '08:00', days: [1, 2, 3, 4, 5], enabled: true };

/** "Weekdays at 08:00", "Every day at 18:30", "Mon, Wed at 09:00". */
export function describeWhen(days: readonly number[], time: string): string {
  const set = [...days].sort((a, b) => a - b).join(',');
  const which = set === '1,2,3,4,5,6,7' ? 'Every day' : set === '1,2,3,4,5' ? 'Weekdays' : set === '6,7' ? 'Weekends' : DAYS.filter((d) => days.includes(d.n)).map((d) => d.short).join(', ');
  return `${which} at ${time}`;
}

function Editor({ start, onSave, onCancel }: { start: ScheduleDraft; onSave: (draft: ScheduleDraft) => Promise<string | null>; onCancel: () => void }) {
  const [draft, setDraft] = useState(start);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = draft.title.trim() !== '' && draft.prompt.trim() !== '' && draft.days.length > 0 && /^\d{2}:\d{2}$/.test(draft.time);
  return (
    <form className="schedule-editor" aria-label="Schedule" onSubmit={(e) => { e.preventDefault(); void onSave(draft).then(setProblem); }}>
      <label className="field">Name<input value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Morning brief" /></label>
      <label className="field">What to ask<textarea rows={3} value={draft.prompt} maxLength={4000} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} placeholder="Look at my tasks for today and tell me what to do first." /></label>
      <div className="schedule-when">
        <label className="field">Time<input type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} /></label>
        <div className="schedule-days" role="group" aria-label="Days">
          {DAYS.map((d) => (
            <button key={d.n} type="button" className="schedule-day" aria-pressed={draft.days.includes(d.n)} aria-label={d.long}
              onClick={() => setDraft({ ...draft, days: draft.days.includes(d.n) ? draft.days.filter((x) => x !== d.n) : [...draft.days, d.n].sort((a, b) => a - b) })}>{d.short.slice(0, 2)}</button>
          ))}
        </div>
      </div>
      {problem && <p className="srow-text" role="alert">{problem}</p>}
      <div className="schedule-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!ready}>Save</button>
      </div>
    </form>
  );
}

/**
 * Settings › Schedules: things to ask Mobius at a time of day, on chosen days. Each run is a new conversation in the
 * Agent app, so what it did can be read and its changes reviewed.
 */
export function SchedulesSection({ subpage, highlight, onOpenConversation }: SectionProps) {
  const api = window.mobius.schedules;
  const [list, setList] = useState<ScheduleInfo[] | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api?.list().then((l) => live && setList(l)).catch(() => live && setList([]));
    load();
    const off = api?.onChange(load);
    return () => { live = false; off?.(); };
  }, [api]);
  const path = (row: string) => settingPath('schedules', subpage, row);
  if (!api) return <p className="srow-text">Schedules are not available here.</p>;
  const save = async (id: string | null, draft: ScheduleDraft) => {
    const result = id ? await api.update(id, draft) : await api.add(draft);
    if (!result.ok) return result.error;
    setEditing(null);
    return null;
  };
  return (
    <Row path={path('schedules')} title="Scheduled requests" description="Ask Mobius something at a time of day, on the days you choose. Each run is a new conversation, and it asks before acting as usual." highlight={highlight === 'schedules'}>
      {list && list.length === 0 && editing === null && <p className="srow-text">Nothing scheduled. For example: every weekday at 8:00, “Look at my tasks for today and tell me what to do first.”</p>}
      {list && list.length > 0 && (
        <ul className="schedule-list" aria-label="Schedules">
          {list.map((s) => editing === s.id ? (
            <li key={s.id}><Editor start={{ title: s.title, prompt: s.prompt, time: s.time, days: s.days, enabled: s.enabled }} onSave={(d) => save(s.id, d)} onCancel={() => setEditing(null)} /></li>
          ) : (
            <li key={s.id} className="schedule-item" data-off={!s.enabled || undefined}>
              <span className="schedule-text"><strong>{s.title}</strong><span>{describeWhen(s.days, s.time)}{s.enabled ? '' : ' · Off'}</span></span>
              <label className="switch-line"><input type="checkbox" role="switch" aria-label={`${s.title} on`} checked={s.enabled} onChange={(e) => void api.update(s.id, { title: s.title, prompt: s.prompt, time: s.time, days: s.days, enabled: e.target.checked })} /></label>
              <button type="button" className="btn" onClick={() => void api.runNow(s.id).then((r) => { if (r.ok) { setProblem(null); onOpenConversation(r.conversation); } else setProblem(r.error); })}>Run now</button>
              <button type="button" className="btn" onClick={() => setEditing(s.id)}>Edit</button>
              <button type="button" className="btn" aria-label={`Delete ${s.title}`} onClick={() => void api.remove(s.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {editing === 'new' ? <Editor start={EMPTY} onSave={(d) => save(null, d)} onCancel={() => setEditing(null)} /> : <button type="button" className="btn" onClick={() => setEditing('new')}>New schedule…</button>}
      {problem && <p className="srow-text" role="alert">{problem}</p>}
    </Row>
  );
}

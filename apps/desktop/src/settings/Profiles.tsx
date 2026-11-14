import { useEffect, useState } from 'react';
import type { ProfilesState } from '@mobius/shared';
import { Row } from './primitives';
import { settingPath } from './manifest';

/** The demo workspace's profile (crates/mobius-shell/src/profiles.rs). */
const DEMO_ID = 'demo';

/**
 * Settings › Advanced › Profiles: separate Mobiuses for separate parts of life, each with its own conversations, notes,
 * tasks, memory, schedules and settings. Switching starts Mobius again with the other profile.
 */
export function ProfilesPane({ subpage, highlight }: { subpage: string; highlight: string | null }) {
  const api = window.mobius.profiles;
  const [state, setState] = useState<ProfilesState | null>(null);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  useEffect(() => { void api?.list().then(setState).catch(() => setState(null)); }, [api]);
  if (!api) return <p className="srow-text">Profiles are not available here.</p>;
  const settle = (r: { ok: true; profiles: ProfilesState } | { ok: false; error: string }) => {
    if (r.ok) { setState(r.profiles); setProblem(null); return true; }
    setProblem(r.error);
    return false;
  };
  return (
    <Row path={settingPath('advanced', subpage, 'profiles')} title="Profiles" description="Keep parts of your life apart: each profile has its own conversations, notes, tasks, memory, schedules and settings. Downloaded models are shared." highlight={highlight === 'profiles'}>
      {state && (
        <ul className="schedule-list" aria-label="Profiles">
          {state.list.map((p) => (
            <li key={p.id} className="schedule-item">
              <span className="schedule-text"><strong>{p.name}</strong>{p.id === state.current && <span>Open now</span>}</span>
              {p.id !== state.current && (
                <>
                  <button type="button" className="btn" disabled={switching} onClick={() => { setSwitching(true); void api.switch(p.id).then((r) => { if (!settle(r)) setSwitching(false); }); }}>Switch</button>
                  {p.id !== 'default' && <button type="button" className="btn" aria-label={`Remove ${p.name}`} onClick={() => void api.remove(p.id).then(settle)}>Remove</button>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="profile-new" aria-label="New profile" onSubmit={(e) => { e.preventDefault(); void api.create(name).then((r) => { if (settle(r)) setName(''); }); }}>
        <input value={name} maxLength={40} aria-label="Name of the new profile" placeholder="Work" onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={name.trim() === ''}>New profile</button>
      </form>
      {switching && <p className="srow-text" role="status">Starting Mobius again with that profile…</p>}
      {problem && <p className="srow-text" role="alert">{problem}</p>}
      <p className="srow-text">Switching starts Mobius again. Removing a profile takes it off this list; its files stay in the data folder.</p>
      {api.openDemo && state && (
        <div className="profile-demo">
          <p className="srow-text">{state.current === DEMO_ID
            ? 'This is the demo workspace: a made-up team\'s mail, calendar, notes and files. Reset it to start the tour over; what was changed is gone.'
            : 'The demo workspace is a made-up team\'s mail, calendar, notes and files, for trying Mobius without your own. It opens as a profile of its own, fresh each time.'}</p>
          <button type="button" className="btn" disabled={switching} onClick={() => { setSwitching(true); void api.openDemo!().then((r) => { if (!settle(r)) setSwitching(false); }); }}>
            {state.current === DEMO_ID ? 'Reset the demo workspace' : 'Open the demo workspace'}
          </button>
        </div>
      )}
    </Row>
  );
}

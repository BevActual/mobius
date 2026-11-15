import { MODES, modeOf } from './approval-modes';
import { MobiusMark } from './MobiusMark';
import { usePreferences } from './usePreferences';

const LEVELS = MODES.map((m) => ({ id: m.id, name: m.name, sub: m.help }));

/**
 * The first thing a new person sees, above setting up a model: who Mobius is, and how much it should do on its own.
 * The choice is the same approval setting as in the message box and Settings › Approvals and safety.
 */
export function Welcome() {
  const preferences = usePreferences();
  const chosen = preferences.value.approvalMode;
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      {/* The mark arriving band by band: Mobius's hello. Still for people who ask for less motion. */}
      <MobiusMark size={88} className="welcome-mark" />
      <h1 id="welcome-title" className="welcome-title">Hello.</h1>
      <p className="welcome-lede">Every app. One agent. Mobius is your everyday apps in one place, with an agent that works across all of them, and it asks before it acts.</p>
      <div className="welcome-levels" role="radiogroup" aria-label="How much should Mobius do?">
        <h2 className="welcome-h">How much should Mobius do?</h2>
        {LEVELS.map((level) => (
          <button key={level.id} type="button" role="radio" aria-checked={modeOf(chosen).id === level.id} className="welcome-level" onClick={() => void preferences.set({ approvalMode: level.id })}>
            <span className="welcome-dot" aria-hidden="true" />
            <span className="welcome-level-text"><strong>{level.name}</strong><span>{level.sub}</span></span>
          </button>
        ))}
        <p className="welcome-note">You can change this any time, from the message box or Settings › Approvals and safety.</p>
      </div>
      <h2 className="welcome-h welcome-next">Then choose a model</h2>
    </section>
  );
}

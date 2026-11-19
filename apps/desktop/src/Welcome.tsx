import { MODES, modeOf } from './approval-modes';
import { MobiusMark } from './MobiusMark';
import { usePreferences } from './usePreferences';

// One line each here: the full meaning is in Settings › Approvals and safety, and the model comes next.
const LEVELS = MODES.map((m) => ({ id: m.id, name: m.name, sub: m.hint, help: m.help }));

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
      <MobiusMark size={64} className="welcome-mark" />
      <h1 id="welcome-title" className="welcome-title">Hello.</h1>
      <p className="welcome-lede">Your everyday apps in one place, with an agent that works across all of them. It asks before it acts.</p>
      <div className="welcome-levels" role="radiogroup" aria-label="How much should Mobius do?">
        <h2 className="welcome-h">How much should Mobius do?</h2>
        {LEVELS.map((level) => (
          <button key={level.id} type="button" role="radio" aria-checked={modeOf(chosen).id === level.id} className="welcome-level" title={level.help} onClick={() => void preferences.set({ approvalMode: level.id })}>
            <span className="welcome-dot" aria-hidden="true" />
            <span className="welcome-level-text"><strong>{level.name}</strong><span>{level.sub}</span></span>
          </button>
        ))}
        <p className="welcome-note">Change it any time in the message box.</p>
      </div>
      <h2 className="welcome-h welcome-next">Choose a model</h2>
    </section>
  );
}

import type { ApprovalModeChoice } from '@mobius/shared';
import { usePreferences } from './usePreferences';

const LEVELS: { id: ApprovalModeChoice; name: string; sub: string }[] = [
  { id: 'manual', name: 'Ask first', sub: 'Mobius checks with you before every action. Good for getting to know it.' },
  { id: 'smart', name: 'Smart approvals', sub: 'Mobius goes ahead with what is clearly safe and asks about the rest.' },
  { id: 'off', name: 'Act', sub: 'Mobius acts without asking. Blocked sites and actions stay blocked.' },
];

/** The whorl print drawing itself in, then its core lighting: Mobius's hello. Still for people who ask for less motion. */
function DrawnMark() {
  const rings = ['M63.68 89.59A40 40 0 1 1 87.59 65.68', 'M39.74 23.81A30 30 0 1 1 21.81 41.74', 'M68.79 58.84A20 20 0 1 1 67.32 42', 'M40.6 55.42A10 10 0 1 1 46.58 61.4'];
  return (
    <svg className="welcome-mark" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={5} aria-hidden="true" style={{ width: 88, height: 88 }}>
      {rings.map((d, i) => <path key={d} d={d} pathLength={100} className="welcome-ring" style={{ animationDelay: `${i * 0.18}s` }} />)}
      <circle cx="50" cy="52" r="3.5" fill="currentColor" stroke="none" className="welcome-core" />
    </svg>
  );
}

/**
 * The first thing a new person sees, above setting up a model: who Mobius is, and how much it should do on its own.
 * The choice is the same approval setting as in the message box and Settings › Safety.
 */
export function Welcome() {
  const preferences = usePreferences();
  const chosen = preferences.value.approvalMode;
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <DrawnMark />
      <h1 id="welcome-title" className="welcome-title">Hello.</h1>
      <p className="welcome-lede">Mobius is one assistant inside your browser, notes and tasks. It works where you are, and asks before it acts.</p>
      <div className="welcome-levels" role="radiogroup" aria-label="How much should Mobius do?">
        <h2 className="welcome-h">How much should Mobius do?</h2>
        {LEVELS.map((level) => (
          <button key={level.id} type="button" role="radio" aria-checked={chosen === level.id} className="welcome-level" onClick={() => void preferences.set({ approvalMode: level.id })}>
            <span className="welcome-dot" aria-hidden="true" />
            <span className="welcome-level-text"><strong>{level.name}</strong><span>{level.sub}</span></span>
          </button>
        ))}
        <p className="welcome-note">You can change this any time, from the message box or Settings › Safety.</p>
      </div>
      <h2 className="welcome-h welcome-next">Then choose a model</h2>
    </section>
  );
}

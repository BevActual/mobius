import { useEffect, useRef, useState } from 'react';
import type { Activity } from './activity';

interface Props {
  activity: Activity;
  onOpen: () => void;
  onStop: () => void;
  /** Pause Mobius where it is (the person takes over). Resolves with what went wrong, or null. */
  onPause?: () => Promise<string | null>;
  /** Let a paused Mobius carry on from where it stopped. */
  onResume?: () => Promise<string | null>;
}

/**
 * Mobius at work while its panel is closed: a small pill beside the Mobius button that says what it is doing and how
 * far through its plan it is, with Pause and Stop. Pause stops it at once and leaves the app to you (as starting to
 * type in the app it is working in does); Resume carries on from there. It does not open the panel on its own; when
 * Mobius needs an answer the pill says so in ink, and a press opens the panel there.
 */
export function WorkingPill({ activity, onOpen, onStop, onPause, onResume }: Props) {
  const [problem, setProblem] = useState<string | null>(null);
  const paused = activity.paused;
  const step = paused
    ? (paused.of && paused.of > 1 ? `step ${Math.min(paused.step, paused.of)} of ${paused.of}` : paused.step > 0 ? `at step ${paused.step}` : null)
    : activity.step && activity.step.total > 1 ? `${Math.min(activity.step.done + 1, activity.step.total)} of ${activity.step.total}` : null;
  // Pause and Resume take each other's place: the keys follow, so the focus is never left on nothing.
  const pauseButton = useRef<HTMLButtonElement>(null);
  const resumeButton = useRef<HTMLButtonElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const handOn = useRef<'pause' | 'resume' | null>(null);
  useEffect(() => {
    if (!handOn.current) return;
    const to = (handOn.current === 'resume' ? resumeButton.current : pauseButton.current) ?? openButton.current;
    handOn.current = null;
    to?.focus();
  }, [paused]);
  const run = (act: (() => Promise<string | null>) | undefined, next: 'pause' | 'resume') => {
    if (!act) return;
    handOn.current = next;
    void act().then((p) => { setProblem(p); if (p) handOn.current = null; });
  };
  return (
    <div className="working-pill" role="status" data-needs-you={activity.needsYou || undefined} data-paused={paused ? '' : undefined}>
      <button ref={openButton} type="button" className="working-pill-open" onClick={onOpen} title={problem ?? 'Show Mobius'}>
        <span className="working-pill-mark" aria-hidden="true" />
        <span className="working-pill-label">{activity.needsYou ? 'Mobius needs you' : paused ? 'Paused' : activity.label}</span>
        {step && !activity.needsYou && <span className="working-pill-step">{step}</span>}
      </button>
      {paused && onResume && (
        <button ref={resumeButton} type="button" className="working-pill-resume" onClick={() => run(onResume, 'pause')}>Resume</button>
      )}
      {!paused && !activity.needsYou && onPause && (
        <button ref={pauseButton} type="button" className="working-pill-stop" aria-label="Pause Mobius" title="Pause" onClick={() => run(onPause, 'resume')}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4" width="2.5" height="8" rx="1" /><rect x="9" y="4" width="2.5" height="8" rx="1" /></svg>
        </button>
      )}
      {!activity.needsYou && (
        <button type="button" className="working-pill-stop" aria-label="Stop Mobius" title="Stop" onClick={onStop}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" /></svg>
        </button>
      )}
      {problem && <span className="sr-only">{problem}</span>}
    </div>
  );
}

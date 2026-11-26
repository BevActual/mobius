import type { Activity } from './activity';

/**
 * Mobius at work while its panel is closed: a small pill beside the Mobius button that says what it is doing and how
 * far through its plan it is, with Stop. It does not open the panel on its own; when Mobius needs an answer the pill
 * says so in ink, and a press opens the panel there.
 */
export function WorkingPill({ activity, onOpen, onStop }: { activity: Activity; onOpen: () => void; onStop: () => void }) {
  const step = activity.step && activity.step.total > 1 ? `${Math.min(activity.step.done + 1, activity.step.total)} of ${activity.step.total}` : null;
  return (
    <div className="working-pill" role="status" data-needs-you={activity.needsYou || undefined}>
      <button type="button" className="working-pill-open" onClick={onOpen} title="Show Mobius">
        <span className="working-pill-mark" aria-hidden="true" />
        <span className="working-pill-label">{activity.needsYou ? 'Mobius needs you' : activity.label}</span>
        {step && !activity.needsYou && <span className="working-pill-step">{step}</span>}
      </button>
      {!activity.needsYou && (
        <button type="button" className="working-pill-stop" aria-label="Stop Mobius" title="Stop" onClick={onStop}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" /></svg>
        </button>
      )}
    </div>
  );
}

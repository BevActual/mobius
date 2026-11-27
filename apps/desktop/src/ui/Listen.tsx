import { useSpeech } from '../useSpeech';

/** Asks the shell to open Settings at speaking (App listens for it): a Listen button sits in apps that can't reach it. */
export const OPEN_SPEAKING_SETTINGS = 'mobius:open-speaking-settings';

/**
 * Listen: reads what is open aloud (a note, a document, a letter, an article), with whoever is chosen to speak in
 * Settings, Models. Pressed again, or Esc, it stops. Nothing is read until it is pressed. When speaking isn't set up,
 * it says so beside the button, with the way to set it up.
 */
export function ListenButton({ id, text, className = 'doc-tool' }: { id: string; text: () => string; /** The look of the toolbar it sits in: `ui-icon-button` draws its icon in a span, as IconButton does. */ className?: string }) {
  const { speech, speak, stop, dismiss } = useSpeech();
  const mine = speech.state !== 'idle' && speech.id === id;
  const loading = mine && speech.state === 'loading';
  const speaking = mine && (speech.state === 'speaking' || loading);
  const label = loading ? 'Getting the voice…' : speaking ? 'Stop listening' : 'Listen';
  const icon = (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {speaking ? <path d="M7 6.5h2v7H7zM11 6.5h2v7h-2z" /> : <path d="M3.5 8v4h3l4 3.5v-11L6.5 8zM13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9" />}
    </svg>
  );
  return (
    <>
      <button type="button" className={className} aria-label={label} title={speaking ? 'Stop listening (Esc)' : 'Listen: read this aloud'} aria-pressed={speaking} aria-busy={loading || undefined} data-listen=""
        onPointerDown={(e) => e.preventDefault()} onClick={() => (speaking ? stop() : void speak(id, text()))}>
        {className.includes('ui-icon-button') ? <span className="ui-icon-button-icon" aria-hidden="true">{icon}</span> : icon}
      </button>
      {mine && speech.state === 'failed' && (
        <span className="listen-problem" role="alert">
          {speech.error}
          {speech.setup && <> <button type="button" className="link-btn" onClick={() => { dismiss(); window.dispatchEvent(new CustomEvent(OPEN_SPEAKING_SETTINGS)); }}>Set up speaking</button></>}
          <button type="button" className="link-btn" aria-label="Dismiss" onClick={dismiss}>×</button>
        </span>
      )}
    </>
  );
}

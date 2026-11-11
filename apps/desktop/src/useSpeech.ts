import { useCallback, useEffect, useRef, useState } from 'react';
import { SPEECH_IDLE, speechNext, type Speech, type SpeechEvent } from './speech';

/** Read a reply aloud with the service chosen in Settings, Voice. Esc stops it; so does starting another. */
export function useSpeech() {
  const [speech, setSpeech] = useState<Speech>(SPEECH_IDLE);
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = useRef<Speech>(SPEECH_IDLE);
  const apply = useCallback((e: SpeechEvent) => {
    current.current = speechNext(current.current, e);
    setSpeech(current.current);
  }, []);

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (current.current.state !== 'idle') apply({ kind: 'stop' });
  }, [apply]);

  const speak = useCallback(async (id: string, text: string) => {
    stop();
    apply({ kind: 'start', id });
    const api = window.mobius.voice?.speak;
    const result = api ? await api(text).catch(() => null) : null;
    if (!result || !result.ok) {
      apply({ kind: 'failed', id, error: result && !result.ok ? result.error : 'Speaking is not available here.', setup: Boolean(result && !result.ok && result.setup) });
      return;
    }
    // Asked to stop, or another reply was asked for, while the sound was coming.
    if (current.current.state !== 'loading' || current.current.id !== id) return;
    const player = new Audio(result.audio);
    audio.current = player;
    player.onended = () => { if (audio.current === player) audio.current = null; apply({ kind: 'ended', id }); };
    player.onerror = () => apply({ kind: 'failed', id, error: 'The sound could not be played.', setup: false });
    apply({ kind: 'ready', id });
    await player.play().catch(() => apply({ kind: 'failed', id, error: 'The sound could not be played.', setup: false }));
  }, [apply, stop]);

  // Esc stops reading, wherever the keys are.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && current.current.state !== 'idle' && current.current.state !== 'failed') stop(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); audio.current?.pause(); };
  }, [stop]);

  return { speech, speak, stop, dismiss: () => apply({ kind: 'stop' }) };
}

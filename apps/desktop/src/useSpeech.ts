import { useCallback, useEffect, useRef, useState } from 'react';
import { SPEECH_IDLE, speechNext, speechParts, spokenText, type Speech, type SpeechEvent } from './speech';

/** Every reader that is open: starting one stops the others, so only one thing is read aloud at a time. */
const readers = new Set<() => void>();

/** Read a reply or a page aloud with the service chosen for speaking. Esc stops it; so does starting another. */
export function useSpeech() {
  const [speech, setSpeech] = useState<Speech>(SPEECH_IDLE);
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = useRef<Speech>(SPEECH_IDLE);
  const apply = useCallback((e: SpeechEvent) => {
    current.current = speechNext(current.current, e);
    setSpeech(current.current);
  }, []);

  // Each reading has its number: a part that comes back after Stop, or after another reading began, is dropped.
  const run = useRef(0);
  const stop = useCallback(() => {
    run.current += 1;
    audio.current?.pause();
    audio.current = null;
    if (current.current.state !== 'idle') apply({ kind: 'stop' });
  }, [apply]);

  /**
   * Reads `text` (Markdown is read as its words) in parts, one after another: the first part is asked for alone, so it
   * is heard soon, and each next one is asked for while the one before plays.
   */
  const speak = useCallback(async (id: string, text: string) => {
    for (const other of readers) if (other !== stop) other();
    stop();
    const mine = run.current;
    apply({ kind: 'start', id });
    const api = window.mobius.voice?.speak;
    const parts = speechParts(spokenText(text));
    const fail = (error: string, setup = false) => { if (run.current === mine) apply({ kind: 'failed', id, error, setup }); };
    if (!api) return fail('Speaking is not available here.');
    if (!parts.length) return fail('There is nothing to read.');
    const ask = (i: number) => api(parts[i]!).catch(() => null);
    let coming = ask(0);
    for (let i = 0; i < parts.length; i++) {
      const result = await coming;
      if (run.current !== mine) return;
      if (!result || !result.ok) return fail(result && !result.ok ? result.error : 'Speaking is not available here.', Boolean(result && !result.ok && result.setup));
      if (i + 1 < parts.length) coming = ask(i + 1);
      const player = new Audio(result.audio);
      audio.current = player;
      if (i === 0) apply({ kind: 'ready', id });
      const played = await new Promise<boolean>((resolve) => {
        player.onended = () => resolve(true);
        player.onpause = () => resolve(true);
        player.onerror = () => resolve(false);
        player.play().catch(() => resolve(false));
      });
      if (run.current !== mine) return;
      if (!played) return fail('The sound could not be played.');
    }
    audio.current = null;
    apply({ kind: 'ended', id });
  }, [apply, stop]);

  // Esc stops reading, wherever the keys are.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && current.current.state !== 'idle' && current.current.state !== 'failed') stop(); };
    window.addEventListener('keydown', onKey);
    readers.add(stop);
    return () => { window.removeEventListener('keydown', onKey); readers.delete(stop); audio.current?.pause(); };
  }, [stop]);

  return { speech, speak, stop, dismiss: () => apply({ kind: 'stop' }) };
}

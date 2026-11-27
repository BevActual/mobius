import { useCallback, useEffect, useRef, useState } from 'react';
import { SPEECH_IDLE, speechNext, speechParts, spokenText, type Speech, type SpeechEvent } from './speech';

/** A blob: address for a `data:` sound (other addresses are kept as they are). */
export function soundUrl(audio: string): string {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(audio);
  if (!m || typeof URL.createObjectURL !== 'function') return audio;
  const body = m[2] ? atob(m[3]!) : decodeURIComponent(m[3]!);
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: m[1] || 'audio/wav' }));
}

/** Every reader that is open: starting one stops the others, so only one thing is read aloud at a time. */
const readers = new Set<() => void>();

/** The Listen buttons' readers among them: what is read from a page, not Mobius's replies. */
const pageReaders = new Set<() => void>();

/** Stops a page being read aloud: the window calls it when you go to another app or tab. */
export function stopReading(): void {
  for (const stop of pageReaders) stop();
}

/** Read a reply or a page aloud with the service chosen for speaking. Esc stops it; so does starting another. */
export function useSpeech(of: 'page' | 'chat' = 'chat') {
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
   * Reads `text` (Markdown is read as its words) in parts, one after another: the first part is short, so it is heard
   * soon, and the next ones are made while the ones before play.
   */
  const speak = useCallback(async (id: string, text: string) => {
    for (const other of readers) if (other !== stop) other();
    stop();
    const mine = run.current;
    apply({ kind: 'start', id });
    const api = window.mobius.voice?.speak;
    const parts = speechParts(spokenText(text), 500, 100);
    const fail = (error: string, setup = false) => { if (run.current === mine) apply({ kind: 'failed', id, error, setup }); };
    if (!api) return fail('Speaking is not available here.');
    if (!parts.length) return fail('There is nothing to read.');
    // Two parts are asked for ahead of the one playing, each once the one before it is made, so the voice keeps
    // working while you listen and the next part is ready before this one ends.
    const asked: Promise<Awaited<ReturnType<typeof api>> | null>[] = [];
    const ask = (i: number): void => {
      if (i >= parts.length || asked[i]) return;
      const before = i > 0 ? asked[i - 1]! : Promise.resolve(null);
      asked[i] = before.then(() => (run.current === mine ? api(parts[i]!) : null)).catch(() => null);
    };
    ask(0);
    for (let i = 0; i < parts.length; i++) {
      ask(i + 1);
      ask(i + 2);
      const result = await asked[i]!;
      if (run.current !== mine) return;
      if (!result || !result.ok) return fail(result && !result.ok ? result.error : 'Speaking is not available here.', Boolean(result && !result.ok && result.setup));
      // The window's content rules let sound play from blob: but not data: addresses, so the sound is handed over as one.
      const url = soundUrl(result.audio);
      const player = new Audio(url);
      audio.current = player;
      if (i === 0) apply({ kind: 'ready', id });
      const played = await new Promise<boolean>((resolve) => {
        player.onended = () => resolve(true);
        player.onpause = () => resolve(true);
        player.onerror = () => resolve(false);
        player.play().catch(() => resolve(false));
      });
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
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
    if (of === 'page') pageReaders.add(stop);
    // Leaving the page (or the app) stops its reading too: nothing is left playing that its button and Esc can't reach.
    return () => { window.removeEventListener('keydown', onKey); readers.delete(stop); pageReaders.delete(stop); run.current += 1; audio.current?.pause(); audio.current = null; };
  }, [stop, of]);

  return { speech, speak, stop, dismiss: () => apply({ kind: 'stop' }) };
}

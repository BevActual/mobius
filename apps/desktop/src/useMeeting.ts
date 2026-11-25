import { useCallback, useEffect, useRef, useState } from 'react';

export type MeetingState = 'idle' | 'recording' | 'finishing';

/** A meeting is heard in parts of this many seconds, each written down while the next is heard. */
export const MEETING_PART_SECONDS = 120;
/** The longest meeting, in seconds. It stops by itself then. */
export const MEETING_MAX_SECONDS = 3 * 60 * 60;

const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/**
 * Record a meeting from the microphone and write down what was said. Unlike dictation it runs for hours: the sound is cut
 * into parts that are each a whole recording, and each part goes to the speech model while the next is heard, so the words
 * are ready soon after the meeting ends. Nothing is kept but the words.
 *
 * Where Mobius can hear the microphone itself (`window.mobius.meeting`), it does, and cuts the parts; the window only
 * asks for each to be written down. Elsewhere (the preview, Linux) the window records it with MediaRecorder.
 */
export function useMeeting(onDone: (parts: string[], seconds: number, started: Date) => void, partSeconds = MEETING_PART_SECONDS, maxSeconds = MEETING_MAX_SECONDS): {
  state: MeetingState; seconds: number; heard: number; problem: string | null; start: () => void; stop: () => void; cancel: () => void; clearProblem: () => void;
} {
  const [state, setState] = useState<MeetingState>('idle');
  const [seconds, setSeconds] = useState(0);
  // How many parts are written down so far.
  const [heard, setHeard] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const parts = useRef<string[]>([]);
  const failed = useRef<string | null>(null);
  // Each part's writing down, in order; the meeting ends once all are back.
  const pending = useRef<Promise<void>>(Promise.resolve());
  const running = useRef(false);
  const discard = useRef(false);
  const live = useRef(true);
  const elapsed = useRef(0);
  const started = useRef(new Date());
  const done = useRef(onDone);
  done.current = onDone;
  // Heard by Mobius rather than the window, and its events while it is.
  const native = useRef(false);
  // Set once the meeting has finished, so it is handed over only once.
  const ended = useRef(false);
  const unlisten = useRef<(() => void) | null>(null);

  const release = useCallback(() => {
    window.clearInterval(timer.current);
    timer.current = undefined;
    unlisten.current?.();
    unlisten.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    recorder.current = null;
  }, []);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      running.current = false;
      discard.current = true;
      if (native.current) void window.mobius.meeting?.cancel().catch(() => undefined);
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      release();
    };
  }, [release]);

  const end = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    release();
    if (discard.current || !live.current) { setState('idle'); return; }
    setState('finishing');
    void pending.current.then(() => {
      if (!live.current) return;
      setState('idle');
      if (failed.current) setProblem(failed.current);
      if (!discard.current) done.current([...parts.current], elapsed.current, started.current);
    });
  }, [release]);

  // One part: a recorder of its own on the same microphone, so each part is a file the speech model can read alone.
  const listen = useCallback((media: MediaStream) => {
    const mimeType = MIME.find((type) => MediaRecorder.isTypeSupported(type));
    const next = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const index = parts.current.length;
    parts.current.push('');
    next.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    next.onstop = () => {
      if (!discard.current && chunks.length) {
        const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
        pending.current = pending.current.then(async () => {
          try {
            const result = await window.mobius.agent.transcribe(await blob.arrayBuffer(), blob.type);
            if (result.ok) parts.current[index] = result.text;
            else failed.current = `Part of the meeting could not be written down: ${result.error}`;
          } catch {
            failed.current = 'Part of the meeting could not be written down.';
          }
          if (live.current) setHeard((n) => n + 1);
        });
      }
      if (running.current && stream.current) listen(stream.current);
      else end();
    };
    recorder.current = next;
    next.start();
  }, [end]);

  // The seconds on show, once a second; at the longest meeting it stops.
  const tick = useCallback((onSecond: () => void) => {
    timer.current = window.setInterval(() => {
      elapsed.current += 1;
      setSeconds(elapsed.current);
      onSecond();
    }, 1000);
  }, []);

  const startHere = useCallback(async (meeting: NonNullable<typeof window.mobius.meeting>) => {
    native.current = true;
    unlisten.current = meeting.onEvent((event) => {
      if (event.kind === 'part') {
        const index = event.index;
        while (parts.current.length <= index) parts.current.push('');
        pending.current = pending.current.then(async () => {
          try {
            const result = await meeting.transcribe(index);
            if (result.ok) parts.current[index] = result.text;
            else failed.current = `Part of the meeting could not be written down: ${result.error}`;
          } catch {
            failed.current = 'Part of the meeting could not be written down.';
          }
          if (live.current) setHeard((n) => n + 1);
        });
      } else if (event.kind === 'problem') {
        failed.current = event.message;
      } else {
        if (event.error) failed.current = event.error;
        running.current = false;
        end();
      }
    });
    const started = await meeting.start(partSeconds === MEETING_PART_SECONDS ? undefined : partSeconds).catch(() => ({ ok: false as const, error: 'Mobius could not use the microphone.' }));
    if (!started.ok) {
      release();
      running.current = false;
      setState('idle');
      setProblem(started.error);
      return;
    }
    if (discard.current || !live.current) {
      void meeting.cancel();
      return;
    }
    setState('recording');
    tick(() => {
      if (elapsed.current >= maxSeconds && running.current) {
        running.current = false;
        window.clearInterval(timer.current);
        setState('finishing');
        void meeting.stop();
      }
    });
  }, [end, release, tick, partSeconds, maxSeconds]);

  const start = useCallback(async () => {
    if (running.current) return;
    setProblem(null);
    parts.current = [];
    failed.current = null;
    pending.current = Promise.resolve();
    discard.current = false;
    ended.current = false;
    elapsed.current = 0;
    started.current = new Date();
    setSeconds(0);
    setHeard(0);
    const meeting = window.mobius.meeting;
    const here = meeting ? await meeting.available().then((r) => r.here).catch(() => false) : false;
    if (meeting && here) {
      running.current = true;
      await startHere(meeting);
      return;
    }
    native.current = false;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      running.current = true;
      listen(media);
      setState('recording');
      tick(() => {
        const rec = recorder.current;
        if (elapsed.current >= maxSeconds) {
          running.current = false;
          if (rec?.state === 'recording') rec.stop();
        } else if (elapsed.current % partSeconds === 0 && rec?.state === 'recording') rec.stop();
      });
    } catch {
      release();
      running.current = false;
      setState('idle');
      setProblem('Mobius could not use the microphone. Check that one is connected and that Mobius is allowed to use it.');
    }
  }, [listen, release, startHere, tick, partSeconds, maxSeconds]);

  const stop = useCallback(() => {
    if (!running.current) return;
    running.current = false;
    window.clearInterval(timer.current);
    if (native.current) {
      // The last part, then the end, come as events: the end finishes the meeting.
      setState('finishing');
      void window.mobius.meeting?.stop().then((r) => { if (!r.ok) end(); }).catch(() => end());
      return;
    }
    if (recorder.current?.state === 'recording') recorder.current.stop();
    else end();
  }, [end]);

  const cancel = useCallback(() => {
    running.current = false;
    discard.current = true;
    if (native.current) void window.mobius.meeting?.cancel().catch(() => undefined);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    release();
    setState('idle');
  }, [release]);

  return { state, seconds, heard, problem, start: () => void start(), stop, cancel, clearProblem: () => setProblem(null) };
}

import { useCallback, useEffect, useRef, useState } from 'react';

export type DictationState = 'idle' | 'recording' | 'transcribing';

/** The longest recording, in seconds. It stops by itself then. */
export const MAX_RECORDING_SECONDS = 120;

/**
 * Record from the microphone and turn it into text with the server's speech model. Nothing is kept: the recording goes to the
 * model server the person chose, and only the words come back.
 */
export function useDictation(onText: (text: string) => void, maxSeconds = MAX_RECORDING_SECONDS): { state: DictationState; seconds: number; level: number; problem: string | null; setup: boolean; toggle: () => void; cancel: () => void; clearProblem: () => void } {
  const [state, setState] = useState<DictationState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  // The problem is that nothing is set up to listen: Settings, Voice is where to fix it.
  const [setup, setSetup] = useState(false);
  // How loud the microphone is, from 0 to 1, while listening.
  const [level, setLevel] = useState(0);
  const meter = useRef<{ context: AudioContext; frame: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const discard = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const live = useRef(true);

  const release = useCallback(() => {
    if (meter.current) {
      window.cancelAnimationFrame(meter.current.frame);
      void meter.current.context.close().catch(() => undefined);
      meter.current = null;
    }
    setLevel(0);
    window.clearInterval(timer.current);
    timer.current = undefined;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      discard.current = true;
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
      release();
    };
  }, [release]);

  const finish = useCallback(async () => {
    const parts = chunks.current;
    chunks.current = [];
    release();
    if (discard.current || !live.current) {
      setState('idle');
      return;
    }
    const blob = new Blob(parts, { type: parts[0]?.type || 'audio/webm' });
    if (blob.size === 0) {
      setState('idle');
      setProblem('Nothing was recorded.');
      return;
    }
    setState('transcribing');
    const result = await window.mobius.agent.transcribe(await blob.arrayBuffer(), blob.type);
    if (!live.current) return;
    setState('idle');
    if (result.ok) onText(result.text);
    else {
      setProblem(result.error);
      setSetup(Boolean((result as { setup?: boolean }).setup));
    }
  }, [onText, release]);

  const start = useCallback(async () => {
    setProblem(null);
    setSetup(false);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(media, preferred ? { mimeType: preferred } : undefined);
      chunks.current = [];
      discard.current = false;
      next.ondataavailable = (event) => { if (event.data.size > 0) chunks.current.push(event.data); };
      next.onstop = () => void finish();
      recorder.current = next;
      // A level meter: how loud the microphone is, read a few times a second.
      try {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context.createMediaStreamSource(media).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += ((v - 128) / 128) ** 2;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
          if (meter.current) meter.current.frame = window.requestAnimationFrame(tick);
        };
        meter.current = { context, frame: window.requestAnimationFrame(tick) };
      } catch {
        // No level then; listening still works.
      }
      next.start();
      setSeconds(0);
      setState('recording');
      timer.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= maxSeconds && recorder.current?.state === 'recording') recorder.current.stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      release();
      setState('idle');
      setProblem('Mobius could not use the microphone. Check that one is connected and that Mobius is allowed to use it.');
    }
  }, [finish, release, maxSeconds]);

  const toggle = useCallback(() => {
    if (state === 'idle') void start();
    else if (state === 'recording') recorder.current?.stop();
  }, [state, start]);

  const cancel = useCallback(() => {
    discard.current = true;
    if (recorder.current && recorder.current.state === 'recording') recorder.current.stop();
    else release();
    setState('idle');
  }, [release]);

  return { state, seconds, level, problem, setup, toggle, cancel, clearProblem: () => { setProblem(null); setSetup(false); } };
}

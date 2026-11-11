/**
 * Reading replies aloud: which reply is being spoken, and what happens next. One reply at a time; starting another,
 * Esc, or a new message stops the one speaking. Kept apart from the audio so the rules can be tested.
 */
export type Speech =
  | { state: 'idle' }
  | { state: 'loading'; id: string }
  | { state: 'speaking'; id: string }
  | { state: 'failed'; id: string; error: string; setup: boolean };

export type SpeechEvent =
  | { kind: 'start'; id: string }
  | { kind: 'ready'; id: string }
  | { kind: 'ended'; id: string }
  | { kind: 'failed'; id: string; error: string; setup: boolean }
  | { kind: 'stop' };

export const SPEECH_IDLE: Speech = { state: 'idle' };

export function speechNext(s: Speech, e: SpeechEvent): Speech {
  switch (e.kind) {
    case 'start':
      return { state: 'loading', id: e.id };
    case 'stop':
      return SPEECH_IDLE;
    // Only the reply asked for last counts: a late answer for another one is ignored.
    case 'ready':
      return s.state === 'loading' && s.id === e.id ? { state: 'speaking', id: e.id } : s;
    case 'ended':
      return (s.state === 'speaking' || s.state === 'loading') && s.id === e.id ? SPEECH_IDLE : s;
    case 'failed':
      return s.state !== 'idle' && s.id === e.id ? { state: 'failed', id: e.id, error: e.error, setup: e.setup } : s;
  }
}

/** Whether this reply is the one speaking or coming. */
export const isSpeaking = (s: Speech, id: string): boolean => (s.state === 'speaking' || s.state === 'loading') && s.id === id;

/**
 * Whether a reply that just finished should be read aloud by itself: the choice is on, a turn has just ended, and the
 * last reply has words that were not read already.
 */
export function readAloudNow(readAloud: boolean, wasBusy: boolean, busy: boolean, lastReply: { id: string; text: string } | null, alreadyRead: string | null): boolean {
  return readAloud && wasBusy && !busy && lastReply !== null && lastReply.text.trim() !== '' && lastReply.id !== alreadyRead;
}

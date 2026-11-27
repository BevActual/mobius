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

/** Markdown as it is heard: no heading marks, list bullets, emphasis, link addresses, code blocks or picture tags. */
export function spokenText(markdown: string): string {
  return markdown
    .replace(/^```[\s\S]*?^```/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*)$/gm, '$1.')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/^[ \t]*(?:---+|\*\*\*+)[ \t]*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +| +$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A long text in parts to read one after another, so the first is heard soon: whole paragraphs, or sentences of a long
 * one, each at most `most` characters, the first at most `first` (a sentence longer than that is cut at a space).
 */
export function speechParts(text: string, most = 500, first = most): string[] {
  const parts: string[] = [];
  let now = '';
  const add = (piece: string) => {
    const p = piece.trim();
    if (!p) return;
    // The first part can be shorter, so the first sound is heard sooner.
    const max = parts.length ? most : first;
    if (now && now.length + 1 + p.length > max) { parts.push(now); now = ''; }
    if (p.length <= max) { now = now ? `${now} ${p}` : p; return; }
    let rest = p;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(' ', max);
      const at = cut > max / 2 ? cut : max;
      parts.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    now = rest;
  };
  for (const paragraph of text.split(/\n\s*\n/)) {
    for (const sentence of paragraph.replace(/\s*\n\s*/g, ' ').split(/(?<!\b(?:Dr|Mr|Mrs|Ms|Prof|St|Mt|Jr|vs)\.)(?<=[.!?…])\s+/)) add(sentence);
    // A paragraph (a list item, a heading) ends with a pause even when it has no full stop.
    if (now && !/[.!?…:;]$/.test(now)) now += '.';
  }
  if (now) parts.push(now);
  return parts.filter((p) => /\p{L}|\d/u.test(p));
}

import { MAIN_BOT_ID, conversationIdFor, type AgentNotification } from '@mobius/shared';

/**
 * Ask inline (docs/design/launcher.md): a short question typed in the launcher is answered there, with the apps the
 * answer came from. It is asked in a conversation of its own, so Continue in Mobius opens it with everything kept.
 */

export interface InlineAnswer {
  conversation: string;
  /** What is shown: the words streaming now, or the last message once it settled. */
  text: string;
  state: 'asking' | 'done' | 'failed';
  /** The apps it read, in the order it read them: "Mail", "Notes". */
  sources: string[];
  error?: string;
}

/** Words that start a question. A question gets its answer in the launcher; anything else goes to the panel. */
const ASKING = /^(who|what|when|where|which|why|how|is|are|was|were|do|does|did|can|could|should|will|would|has|have|had)\b/i;

export function isQuestion(text: string): boolean {
  const t = text.trim();
  return t.length > 3 && t.length <= 300 && (t.endsWith('?') || ASKING.test(t));
}

const APP_OF_TOOL: Record<string, string> = {
  mail: 'Mail', calendar: 'Calendar', tasks: 'Tasks', notes: 'Notes', docs: 'Docs', sheets: 'Sheets', files: 'Files',
  web: 'Web', browser: 'Browser', search: 'Search', contacts: 'People', messages: 'Messages', wiki: 'Knowledge', knowledge: 'Knowledge',
};

/** "mail.search" is Mail; Mobius's own tools (its plan, its questions) are not sources. */
export function sourceOfTool(name: string): string | null {
  const app = name.split(/[._]/)[0]?.toLowerCase() ?? '';
  return APP_OF_TOOL[app] ?? null;
}

/** The answer after one notification from its conversation. Streaming words are kept apart until their message settles. */
export function stepInline(answer: InlineAnswer & { streaming?: string }, n: AgentNotification): InlineAnswer & { streaming?: string } {
  if (n.params.conversation !== answer.conversation) return answer;
  if (n.method === 'agent.delta') {
    const streaming = (answer.streaming ?? '') + n.params.text;
    return { ...answer, streaming, text: streaming };
  }
  if (n.method !== 'agent.event') return answer;
  const e = n.params.event;
  switch (e.kind) {
    case 'message': return { ...answer, streaming: '', text: e.text };
    case 'tool_call': {
      const source = sourceOfTool(e.name);
      return source && !answer.sources.includes(source) ? { ...answer, sources: [...answer.sources, source] } : answer;
    }
    case 'done': return { ...answer, state: 'done', text: answer.text || answer.streaming || '' };
    case 'failed': return { ...answer, state: 'failed', error: e.message };
    case 'cancelled': return { ...answer, state: 'failed', error: 'Stopped.' };
    // Mobius wants to change something, or has a question: that is work for the panel, not an inline answer.
    case 'needs_approval':
    case 'question': return { ...answer, state: 'failed', error: 'Mobius needs you for this one. Continue in Mobius to answer.' };
    default: return answer;
  }
}

/** Asks Mobius, read-only and with the quick model, in a new conversation. Returns a function that stops listening. */
export function askInline(question: string, update: (answer: InlineAnswer) => void): () => void {
  const agent = window.mobius?.agent;
  let answer: InlineAnswer & { streaming?: string } = { conversation: conversationIdFor(MAIN_BOT_ID, crypto.randomUUID()), text: '', state: 'asking', sources: [] };
  const show = () => { const { streaming: _, ...shown } = answer; update(shown); };
  if (!agent) { answer = { ...answer, state: 'failed', error: 'Mobius is not available here.' }; show(); return () => {}; }
  show();
  const off = agent.onNotification((n) => {
    const next = stepInline(answer, n);
    if (next !== answer) { answer = next; show(); }
  });
  void agent.send(answer.conversation, question, undefined, { ask: true, quick: true, app: 'launcher' }).then(
    (r) => { if (!r.ok) { answer = { ...answer, state: 'failed', error: r.error }; show(); } },
    () => { answer = { ...answer, state: 'failed', error: 'Mobius could not be asked.' }; show(); },
  );
  return off;
}

/**
 * About this (docs/design/launcher.md): what was selected in the open app when the launcher opened. The AI commands
 * work on it, and anything typed is asked about it.
 */
export interface LauncherAbout {
  text: string;
}

/** What is selected now: the selected part of a field, or the selected text on the page. Long selections are cut. */
export function selectionNow(doc: Document = document, max = 6000): LauncherAbout | undefined {
  const el = doc.activeElement as (Element & { value?: string; type?: string; selectionStart?: number | null; selectionEnd?: number | null }) | null;
  let text = '';
  const field = el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && /^(text|search|url|email)?$/.test(el.type ?? ''));
  if (field && typeof el?.value === 'string') {
    const from = el.selectionStart ?? null, to = el.selectionEnd ?? null;
    if (from !== null && to !== null && to > from) text = el.value.slice(from, to);
  }
  if (!text) text = doc.getSelection?.()?.toString() ?? '';
  text = text.trim();
  if (text.length < 2) return undefined;
  return { text: text.length > max ? `${text.slice(0, max)}…` : text };
}

export interface AiCommand {
  id: string;
  label: string;
  detail: string;
  /** What Mobius is asked to do with the selection. */
  instruction: string;
}

export const AI_COMMANDS: readonly AiCommand[] = [
  { id: 'summarize', label: 'Summarize', detail: 'In a few short lines', instruction: 'Summarize this in a few short lines.' },
  { id: 'explain', label: 'Explain', detail: 'Simply, as to a newcomer', instruction: 'Explain this simply.' },
  { id: 'fix', label: 'Fix spelling and grammar', detail: 'Copy the result', instruction: 'Fix the spelling and grammar of this, and keep the line breaks. Reply with only the corrected text.' },
  { id: 'shorter', label: 'Make it shorter', detail: 'Same meaning, fewer words', instruction: 'Make this shorter and keep its meaning. Reply with only the new text.' },
  { id: 'reply', label: 'Draft a reply', detail: 'To this message', instruction: 'Draft a short, friendly reply to this message. Reply with only the draft.' },
];

/** "translate to French", "translate into Spanish": the command to translate the selection. */
export function translateCommand(typed: string): AiCommand | null {
  const m = /^translate\s+(?:it\s+)?(?:to|into)\s+(\S.{0,30})$/i.exec(typed.trim());
  if (!m) return null;
  const language = m[1]!.trim().replace(/^./, (c) => c.toUpperCase());
  return { id: `translate-${language.toLowerCase()}`, label: `Translate to ${language}`, detail: 'Copy the result', instruction: `Translate this to ${language}. Keep the names of people, companies and products as they are, and keep the line breaks. Reply with only the translation.` };
}

/**
 * The message sent for a command or question about the selection. Its first line names it ("Summarize: “Hi Maya, the
 * harness…”"), since a conversation is titled by its first line and is found by that title later.
 */
export function aboutPrompt(name: string, instruction: string, about: LauncherAbout): string {
  const line = about.text.replace(/\s+/g, ' ').trim();
  const excerpt = line.length > 40 ? `${line.slice(0, 39)}…` : line;
  const head = name.trim() === instruction.trim() ? name.trim() : `${name.trim()}: “${excerpt}”`;
  return `${head}\n\n${instruction}\n\nThe selected text:\n"""\n${about.text}\n"""`;
}

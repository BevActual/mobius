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

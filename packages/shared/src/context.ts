/**
 * Material the person attaches to a message: a page they have open, or a file. It travels inside the message text,
 * between markers, so that it is saved with the conversation and the model can tell it from what the person typed.
 *
 * It is data, never instructions: a page can say anything. The agent is told so in its system prompt.
 */

export type ContextKind = 'page' | 'file';

export interface ContextItem {
  kind: ContextKind;
  /** A short name for the chip: the page title or the file name. */
  title: string;
  /** Where it came from: the address or the file's name. */
  source: string;
  text: string;
}

export const MAX_CONTEXT_ITEMS = 5;
/** The most characters one attachment may carry. */
export const MAX_CONTEXT_ITEM_CHARS = 20_000;
export const MAX_CONTEXT_TOTAL_CHARS = 60_000;
const MAX_TITLE = 120;
const MAX_SOURCE = 500;
/** What the message text typed by the person may be. */
export const MAX_TYPED_CHARS = 32_000;

const OPEN = '<attached ';
const CLOSE = '</attached>';

const clean = (value: string, limit: number): string => value.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);

/** Whether the item is acceptable as sent by the window. */
export function isContextItem(value: unknown): value is ContextItem {
  if (typeof value !== 'object' || value === null) return false;
  const { kind, title, source, text } = value as Record<string, unknown>;
  return (kind === 'page' || kind === 'file') && typeof title === 'string' && title.length > 0 && title.length <= MAX_TITLE
    && typeof source === 'string' && source.length <= MAX_SOURCE && typeof text === 'string' && text.length <= MAX_CONTEXT_ITEM_CHARS;
}

/** The list is acceptable: few enough, each fine, and not too much altogether. */
export function isContextList(value: unknown): value is ContextItem[] {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_ITEMS) return false;
  let total = 0;
  for (const item of value) {
    if (!isContextItem(item)) return false;
    total += item.text.length;
  }
  return total <= MAX_CONTEXT_TOTAL_CHARS;
}

/** The text the model receives: what the person typed, then each attachment between markers it cannot close early. */
export function withContext(text: string, items: readonly ContextItem[]): string {
  if (items.length === 0) return text;
  const blocks = items.map((item) => {
    const body = item.text.split(CLOSE).join('</ attached>');
    return `${OPEN}kind="${item.kind}" title="${clean(item.title, MAX_TITLE)}" source="${clean(item.source, MAX_SOURCE)}">\n${body}\n${CLOSE}`;
  });
  return `${text}\n\n${blocks.join('\n\n')}`;
}

const BLOCK = /\n\n<attached kind="(page|file)" title="([^"]*)" source="([^"]*)">\n([\s\S]*?)\n<\/attached>/g;

/** The reverse, for showing a saved message: what the person typed, and the attachments to show as chips. */
export function splitContext(message: string): { text: string; items: ContextItem[] } {
  const items: ContextItem[] = [];
  let first = -1;
  for (const match of message.matchAll(BLOCK)) {
    if (first < 0) first = match.index ?? 0;
    items.push({ kind: match[1] as ContextKind, title: match[2] ?? '', source: match[3] ?? '', text: (match[4] ?? '').split('</ attached>').join(CLOSE) });
  }
  return items.length === 0 ? { text: message, items } : { text: message.slice(0, first), items };
}

import type { MailMessage } from '@mobius/shared';

/** A Message-ID without its angle brackets, lower-cased, as References and In-Reply-To quote it. */
const bare = (id: string | undefined): string => (id ?? '').trim().replace(/^<|>$/g, '').toLowerCase();

/**
 * The conversation a message belongs to, as Gmail's conversation view groups them: the first message it replies to
 * (the start of its References), else its own Message-ID, else its own id. Every reply in a thread names the same start.
 */
export function threadKey(m: Pick<MailMessage, 'id' | 'messageId' | 'references'>): string {
  return bare(m.references?.[0]) || bare(m.messageId) || m.id;
}

export interface Thread { key: string; latest: MailMessage; messages: MailMessage[]; unread: boolean; flagged: boolean }

/**
 * A list's messages as conversations, in the list's order (newest first): each shows its latest message, how many
 * there are, and is unread or flagged if any of them is.
 */
export function threads(list: readonly MailMessage[]): Thread[] {
  const out: Thread[] = [];
  const at = new Map<string, Thread>();
  for (const m of list) {
    const key = threadKey(m);
    const t = at.get(key);
    if (t) {
      t.messages.push(m);
      if (m.dateMs > t.latest.dateMs) t.latest = m;
      t.unread ||= !m.seen;
      t.flagged ||= m.flagged;
    } else {
      const made: Thread = { key, latest: m, messages: [m], unread: !m.seen, flagged: m.flagged };
      at.set(key, made);
      out.push(made);
    }
  }
  for (const t of out) t.messages.sort((a, b) => a.dateMs - b.dateMs);
  return out;
}

/** The messages before `open` in its conversation, from all mail (sent replies too), oldest first. */
export function earlierIn(all: readonly MailMessage[], open: Pick<MailMessage, 'id' | 'messageId' | 'references' | 'dateMs'>): MailMessage[] {
  const key = threadKey(open);
  return all.filter((m) => m.id !== open.id && threadKey(m) === key && m.dateMs <= open.dateMs).sort((a, b) => a.dateMs - b.dateMs);
}

/** An attachment's size in words: "820 bytes", "14 KB", "2.3 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/** What kind of file an attachment is, from its name, for its chip's mark. */
export function fileKind(name: string): 'pdf' | 'image' | 'sheet' | 'doc' | 'slides' | 'archive' | 'file' {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return 'image';
  if (['xlsx', 'xls', 'csv', 'ods', 'numbers'].includes(ext)) return 'sheet';
  if (['docx', 'doc', 'odt', 'rtf', 'txt', 'md', 'pages'].includes(ext)) return 'doc';
  if (['pptx', 'ppt', 'odp', 'key'].includes(ext)) return 'slides';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return 'archive';
  return 'file';
}

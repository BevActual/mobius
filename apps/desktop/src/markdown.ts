/**
 * A small Markdown reader for the agent's replies. It understands what models actually write (paragraphs, headings,
 * lists, quotes, code, bold, italic, inline code and links) and turns it into plain data, never HTML, so a reply
 * can never put markup into the window. Anything it does not understand stays as text.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  /** A highlight, `==like this==`, as Reader keeps them. */
  | { kind: 'mark'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  /** A fact marked with where it came from: `[8 people](trust:yours "Calendar · Offsite crew")`. */
  | { kind: 'claim'; tier: 'yours' | 'web' | 'unsure'; source: string; children: Inline[] };

export type Block =
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  /** `checks`: for a to-do list (`- [ ] item`, `- [x] item`), whether each item is done; null for a plain item. */
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][]; checks?: (boolean | null)[] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'code'; lang: string; text: string; open: boolean }
  | { kind: 'rule' };

/** Only web and mail addresses become links; anything else (javascript:, file:) stays text. */
export const safeHref = (href: string): string | null => (/^(https?:\/\/|mailto:)/i.test(href.trim()) ? href.trim() : null);

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => { if (text) { out.push({ kind: 'text', text }); text = ''; } };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_[\]()#>-]/.test(rest[1]!)) { text += rest[1]; i += 2; continue; }
    if (rest[0] === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push({ kind: 'code', text: source.slice(i + 1, end) }); i = end + 1; continue; }
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) { flush(); out.push({ kind: 'strong', children: parseInline(strong[2]!) }); i += strong[0].length; continue; }
    // A lone `_` inside a word (snake_case) is not emphasis.
    const em = /^(\*|_)(?=\S)([\s\S]*?\S)\1(?![\w*])/.exec(rest);
    if (em && !(em[1] === '_' && /\w$/.test(text))) { flush(); out.push({ kind: 'em', children: parseInline(em[2]!) }); i += em[0].length; continue; }
    const mark = /^==(?=\S)([\s\S]*?\S)==/.exec(rest);
    if (mark) { flush(); out.push({ kind: 'mark', children: parseInline(mark[1]!) }); i += mark[0].length; continue; }
    const claim = /^\[([^\]\n]+)\]\(trust:(yours|web|unsure)(?:\s+"([^"\n]*)")?\)/.exec(rest);
    if (claim) { flush(); out.push({ kind: 'claim', tier: claim[2] as 'yours' | 'web' | 'unsure', source: claim[3] ?? '', children: parseInline(claim[1]!) }); i += claim[0].length; continue; }
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2]!);
      if (href) { flush(); out.push({ kind: 'link', href, children: parseInline(link[1]!) }); i += link[0].length; continue; }
    }
    const bare = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(rest);
    if (bare && !/\w$/.test(text)) { flush(); out.push({ kind: 'link', href: bare[0], children: [{ kind: 'text', text: bare[0] }] }); i += bare[0].length; continue; }
    text += rest[0];
    i += 1;
  }
  flush();
  return out;
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBER = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => { if (para.length) { blocks.push({ kind: 'paragraph', children: parseInline(para.join('\n')) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      endPara();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j]!.trimStart().startsWith(fence[1]!)) body.push(lines[j++]!);
      // A reply still streaming may not have closed its code block yet.
      blocks.push({ kind: 'code', lang: fence[2] ?? '', text: body.join('\n'), open: j >= lines.length });
      i = j;
      continue;
    }
    if (!line.trim()) { endPara(); continue; }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) { endPara(); blocks.push({ kind: 'heading', level: Math.min(3, heading[1]!.length) as 1 | 2 | 3, children: parseInline(heading[2]!) }); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { endPara(); blocks.push({ kind: 'rule' }); continue; }
    if (/^\s{0,3}>/.test(line)) {
      endPara();
      const quoted: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ''));
      i -= 1;
      blocks.push({ kind: 'quote', children: parseInline(quoted.join('\n')) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    if (bullet || number) {
      endPara();
      const ordered = number !== null;
      const pattern = ordered ? NUMBER : BULLET;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const match = pattern.exec(current);
        if (match) items.push(ordered ? match[2]! : match[1]!);
        // An indented line carries on the item above it.
        else if (items.length && /^\s{2,}\S/.test(current)) items[items.length - 1] += '\n' + current.trim();
        else break;
        i++;
      }
      i -= 1;
      const checks = items.map((item) => { const box = /^\[([ xX])\]\s+/.exec(item); return box ? box[1] !== ' ' : null; });
      const texts = items.map((item, k) => (checks[k] === null ? item : item.replace(/^\[[ xX]\]\s+/, '')));
      const list: Block = { kind: 'list', ordered, start: ordered ? Number(number![1]) : 1, items: texts.map(parseInline) };
      if (checks.some((c) => c !== null)) list.checks = checks;
      blocks.push(list);
      continue;
    }
    para.push(line);
  }
  endPara();
  return blocks;
}

/** The words of a reply, without its markup: for copying as plain text and for screen-reader summaries. */
export function plainText(nodes: Inline[]): string {
  return nodes.map((n) => (n.kind === 'text' || n.kind === 'code' ? n.text : plainText(n.children))).join('');
}

const CLAIM = /\[([^\]\n]+)\]\(trust:(yours|web|unsure)(?:\s+"([^"\n]*)")?\)/g;
/** A reply's Markdown with its trust marks taken out, for copying: claims keep their words and lose their marks. */
export const withoutMarks = (markdown: string) => markdown.replace(CLAIM, '$1');
/** The facts a reply marks as not sure, each by its words and why: these are checked before the reply leaves Mobius. */
export const unsureClaims = (markdown: string): string[] => [...markdown.matchAll(CLAIM)].filter((m) => m[2] === 'unsure').map((m) => claimKey(m[1]!, m[3] ?? ''));
export const claimKey = (words: string, source: string) => `${words}\u0000${source}`;

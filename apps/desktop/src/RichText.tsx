import { Fragment, createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { claimKey, parseMarkdown, plainText, type Block, type Inline } from './markdown';

/** Links in a reply open as a browser tab in Mobius, not in another program. */
function openLink(href: string) {
  if (/^mailto:/i.test(href)) { window.open(href); return; }
  void window.mobius.browser.open(href);
}

/** Which not-sure facts of a reply the person has checked; the reply's Copy waits until they all are. */
export const ClaimChecks = createContext<{ checked: ReadonlySet<string>; check: (key: string) => void } | null>(null);

const TIERS = {
  yours: { name: 'From your stuff', note: 'Read from your mail, files or calendar.' },
  web: { name: 'From the web', note: 'Linked and dated: prices, times and names older than a day are worth checking again.' },
  unsure: { name: 'Not sure', note: 'Guessed, conflicting or stale. Check it before it leaves Mobius.' },
} as const;

/** A source that is only a tool's id ("id 1", "#3", "work/inbox/7") means nothing to the person: it is not shown. */
export const readableSource = (source: string): string => (/^(id\s*)?#?\d+$/i.test(source.trim()) || /^[^\s/]+\/(inbox|sent)\/\d+$/i.test(source.trim()) ? '' : source);

/** A fact with where it came from: underlined by how sure it is, the source a click away. */
function Claim({ tier, source: given, words, children }: { tier: 'yours' | 'web' | 'unsure'; source: string; words: string; children: ReactNode }) {
  const source = readableSource(given);
  const [open, setOpen] = useState(false);
  const checks = useContext(ClaimChecks);
  const key = claimKey(words, given);
  const checked = tier === 'unsure' && (checks?.checked.has(key) ?? false);
  const shown = checked ? 'Checked by you' : TIERS[tier].name;
  return (
    <span className="claim-wrap">
      <button type="button" className="claim" data-tier={checked ? 'checked' : tier} aria-expanded={open} aria-label={`${words} — ${shown}${source ? `: ${source}` : ''}`} onClick={() => setOpen((o) => !o)}>{children}</button>
      {open && (
        <span className="claim-card" role="note">
          <b>{shown}</b>
          {source && <span>{source}</span>}
          {!checked && <span className="claim-note">{TIERS[tier].note}</span>}
          {tier === 'unsure' && !checked && checks && <button type="button" className="btn" onClick={() => { checks.check(key); setOpen(false); }}>I checked this</button>}
        </span>
      )}
    </span>
  );
}

function inline(nodes: Inline[], key = ''): ReactNode[] {
  return nodes.map((node, i) => {
    const k = `${key}${i}`;
    switch (node.kind) {
      case 'text': return <Fragment key={k}>{node.text}</Fragment>;
      case 'code': return <code key={k}>{node.text}</code>;
      case 'strong': return <strong key={k}>{inline(node.children, `${k}.`)}</strong>;
      case 'em': return <em key={k}>{inline(node.children, `${k}.`)}</em>;
      case 'mark': return <mark key={k}>{inline(node.children, `${k}.`)}</mark>;
      case 'claim': return <Claim key={k} tier={node.tier} source={node.source} words={plainText(node.children)}>{inline(node.children, `${k}.`)}</Claim>;
      case 'link':
        return (
          <a key={k} href={node.href} title={node.href} onClick={(event) => { event.preventDefault(); openLink(node.href); }}>
            {inline(node.children, `${k}.`)}
          </a>
        );
    }
  });
}

function block(node: Block, i: number): ReactNode {
  switch (node.kind) {
    case 'paragraph': return <p key={i}>{inline(node.children)}</p>;
    case 'heading': {
      const Tag = (['h3', 'h4', 'h5'] as const)[node.level - 1]!;
      return <Tag key={i}>{inline(node.children)}</Tag>;
    }
    case 'list': {
      const items = node.items.map((item, j) => {
        const done = node.checks?.[j];
        if (done === undefined || done === null) return <li key={j}>{inline(item)}</li>;
        // A to-do in a reply reads as one; ticking it belongs in Tasks, so the box is for showing only.
        return <li key={j} data-task={done ? 'done' : 'open'}><input type="checkbox" checked={done} disabled aria-label={done ? 'Done' : 'Not done'} />{' '}{inline(item)}</li>;
      });
      const tasks = node.checks !== undefined;
      return node.ordered ? <ol key={i} start={node.start === 1 ? undefined : node.start}>{items}</ol> : <ul key={i} data-tasks={tasks || undefined}>{items}</ul>;
    }
    case 'quote': return <blockquote key={i}>{inline(node.children)}</blockquote>;
    case 'code': return <pre key={i} data-lang={node.lang || undefined}><code>{node.text}</code></pre>;
    case 'rule': return <hr key={i} />;
  }
}

/** A reply from the agent, with its Markdown shown as formatting. */
export function RichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <>{blocks.map(block)}</>;
}

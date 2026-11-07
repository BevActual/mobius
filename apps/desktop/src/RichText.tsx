import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from './markdown';

/** Links in a reply open as a browser tab in Mobius, not in another program. */
function openLink(href: string) {
  if (/^mailto:/i.test(href)) { window.open(href); return; }
  void window.mobius.browser.open(href);
}

function inline(nodes: Inline[], key = ''): ReactNode[] {
  return nodes.map((node, i) => {
    const k = `${key}${i}`;
    switch (node.kind) {
      case 'text': return <Fragment key={k}>{node.text}</Fragment>;
      case 'code': return <code key={k}>{node.text}</code>;
      case 'strong': return <strong key={k}>{inline(node.children, `${k}.`)}</strong>;
      case 'em': return <em key={k}>{inline(node.children, `${k}.`)}</em>;
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
      const items = node.items.map((item, j) => <li key={j}>{inline(item)}</li>);
      return node.ordered ? <ol key={i} start={node.start === 1 ? undefined : node.start}>{items}</ol> : <ul key={i}>{items}</ul>;
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

/**
 * A line of a page's Markdown as people read it: a heading without its #, a list item as a bullet, a checklist item
 * with its box, and bold, italic and code marks taken off. Only for showing; the page keeps its Markdown.
 */
export function readable(line: string): { block: 'h1' | 'h2' | 'h3' | 'li' | 'todo' | 'done' | 'quote' | 'p'; text: string } {
  const marks = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const h = /^(#{1,6})\s+(.*)$/.exec(line);
  if (h) return { block: h[1]!.length === 1 ? 'h1' : h[1]!.length === 2 ? 'h2' : 'h3', text: marks(h[2]!) };
  const todo = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
  if (todo) return { block: todo[1] === ' ' ? 'todo' : 'done', text: marks(todo[2]!) };
  const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (li) return { block: 'li', text: marks(li[1]!) };
  const q = /^>\s?(.*)$/.exec(line);
  if (q) return { block: 'quote', text: marks(q[1]!) };
  return { block: 'p', text: marks(line) };
}

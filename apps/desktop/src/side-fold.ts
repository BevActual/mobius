import { useEffect, type RefObject } from 'react';

/**
 * Folding sections in every app's sidebar, in one place rather than in each sidebar: a section header (an app's
 * `.side-head` title, "From Mobius", Pinned) folds the rows that follow it, up to the next header. What is folded is
 * remembered on this computer, per sidebar and section.
 */
export const FOLD_HEADERS = '.side-head > .side-title, .from-mobius-title, .rail-pinned-title';
const HEADER_OF = '.side-head, .from-mobius-title, .rail-pinned-title';
const KEY = 'mobius.sidebar.folded';

/** The name a section is remembered by: its sidebar, then its title. */
export function foldKey(sidebar: string, title: string): string {
  return `${sidebar.trim()}/${title.trim()}`;
}

function readFolded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeFolded(folded: Set<string>): void {
  try { window.localStorage.setItem(KEY, JSON.stringify([...folded].slice(-200))); } catch { /* Not kept. */ }
}

/** The element whose siblings a header folds: the `.side-head` row for an app's title, else the header itself. */
const rowOf = (title: Element): Element => (title.parentElement?.classList.contains('side-head') ? title.parentElement : title);

/** The rows a header folds: its row's later siblings, up to the next header. */
export function foldedBy(title: Element): Element[] {
  const rows: Element[] = [];
  for (let next = rowOf(title).nextElementSibling; next; next = next.nextElementSibling) {
    if (next.matches(HEADER_OF)) break;
    // Search and New are drawn above the sections, so no section folds them.
    if (next.matches('.side-search, .side-new')) continue;
    rows.push(next);
  }
  return rows;
}

const sidebarOf = (title: Element): string => title.closest('[aria-label]:not(.side-head)')?.getAttribute('aria-label') ?? 'sidebar';

function apply(title: HTMLElement, folded: Set<string>): void {
  const key = foldKey(sidebarOf(title), title.textContent ?? '');
  const isFolded = folded.has(key);
  if (!title.dataset.fold) {
    title.dataset.fold = 'true';
    title.tabIndex = 0;
    // A plain title becomes the fold's button; a real heading stays a heading, so the outline of the page keeps it.
    if (!/^H[1-6]$/.test(title.tagName)) title.setAttribute('role', 'button');
    title.title = 'Fold or unfold this section';
  }
  title.setAttribute('aria-expanded', String(!isFolded));
  for (const row of foldedBy(title)) {
    row.setAttribute('data-fold-body', '');
    if (isFolded) row.setAttribute('data-folded', '');
    else row.removeAttribute('data-folded');
  }
}

/** Make every section header under `root` fold what follows it. */
export function useSideFolds(root: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const node = root.current;
    if (!node || !active) return undefined;
    let folded = readFolded();
    const all = () => node.querySelectorAll<HTMLElement>(FOLD_HEADERS).forEach((title) => apply(title, folded));
    const toggle = (title: HTMLElement) => {
      const key = foldKey(sidebarOf(title), title.textContent ?? '');
      folded = readFolded();
      if (folded.has(key)) folded.delete(key);
      else folded.add(key);
      writeFolded(folded);
      apply(title, folded);
    };
    const header = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('[data-fold]') : null);
    const onClick = (event: MouseEvent) => { const title = header(event.target); if (title && node.contains(title)) toggle(title); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const title = header(event.target);
      if (!title || title !== event.target) return;
      event.preventDefault();
      toggle(title);
    };
    all();
    // Sidebars render their rows as they load and change: new rows take their section's state.
    const watch = new MutationObserver(all);
    watch.observe(node, { childList: true, subtree: true });
    node.addEventListener('click', onClick);
    node.addEventListener('keydown', onKey);
    return () => { watch.disconnect(); node.removeEventListener('click', onClick); node.removeEventListener('keydown', onKey); };
  }, [root, active]);
}

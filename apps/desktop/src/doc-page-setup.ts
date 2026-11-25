/**
 * Page setup (docs/design/docs.md): the paper, its way round and its margins. The page in the window is as wide as
 * the paper's text, and Print or save as PDF uses the same paper and margins. Kept on this device for every document.
 */
export type Paper = 'letter' | 'a4';
export type Orientation = 'portrait' | 'landscape';
export type Margins = 'normal' | 'narrow' | 'wide';
export interface PageSetup { paper: Paper; orientation: Orientation; margins: Margins }

/** Paper sizes in CSS pixels (96 to the inch): Letter is the guide's 816px page. */
const SIZE: Record<Paper, { w: number; h: number }> = { letter: { w: 816, h: 1056 }, a4: { w: 794, h: 1123 } };
/** Margins in inches, as Word names them: Normal 1 inch all round, Narrow half an inch, Wide 2 inches at the sides. */
const MARGIN: Record<Margins, { side: number; top: number }> = { normal: { side: 1, top: 1 }, narrow: { side: 0.5, top: 0.5 }, wide: { side: 2, top: 1 } };

const KEY = 'mobius.docs.page';

/** Letter where it is the custom (the United States, Canada, Mexico and the Philippines), A4 everywhere else. */
export function paperFor(locale: string): Paper {
  return /-(US|CA|MX|PH)\b/i.test(locale) || /^en$/i.test(locale) ? 'letter' : 'a4';
}

export function defaultSetup(locale = typeof navigator === 'undefined' ? 'en-US' : navigator.language): PageSetup {
  return { paper: paperFor(locale), orientation: 'portrait', margins: 'normal' };
}

/** What is kept, read back; anything unknown is the default. */
export function readSetup(raw: string | null, fallback: PageSetup = defaultSetup()): PageSetup {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<PageSetup> | null;
    return {
      paper: v?.paper === 'letter' || v?.paper === 'a4' ? v.paper : fallback.paper,
      orientation: v?.orientation === 'landscape' ? 'landscape' : 'portrait',
      margins: v?.margins === 'narrow' || v?.margins === 'wide' ? v.margins : 'normal',
    };
  } catch {
    return fallback;
  }
}

export function loadSetup(): PageSetup {
  try { return readSetup(window.localStorage.getItem(KEY)); } catch { return defaultSetup(); }
}

export function saveSetup(setup: PageSetup): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(setup)); } catch { /* Not kept. */ }
}

/** How wide the text is on the page, in CSS pixels: the paper's width less its two side margins. */
export function textWidth(setup: PageSetup): number {
  const size = SIZE[setup.paper];
  const w = setup.orientation === 'landscape' ? size.h : size.w;
  return Math.round(w - 2 * MARGIN[setup.margins].side * 96);
}

/** The print rule for the paper and margins. */
export function pageRule(setup: PageSetup): string {
  const m = MARGIN[setup.margins];
  return `@page { size: ${setup.paper === 'a4' ? 'A4' : 'letter'} ${setup.orientation}; margin: ${m.top}in ${m.side}in; }`;
}

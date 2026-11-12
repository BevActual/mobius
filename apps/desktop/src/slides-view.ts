import { blankSlide, type Slide } from './slides-format';

/**
 * The Slides app's arithmetic, kept apart from the screen so it can be tested: moving a slide in the navigator, the
 * layouts a new slide starts from, the presenter's clock, typing a slide number to jump in Play, and how long a deck runs.
 */

/** The list with the item at `from` taken out and put back so it lands before what was at `to` (0 to the length). */
export function moveSlide<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return [...list];
  const at = Math.max(0, Math.min(list.length, to));
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(at > from ? at - 1 : at, 0, item!);
  return next;
}

/** Where a slide dragged to the navigator lands: before or after the thumbnail under the pointer, by its half. */
export function dropIndex(over: number, pointerY: number, top: number, height: number): number {
  return pointerY > top + height / 2 ? over + 1 : over;
}

/** Where the slide picked after a move ends up, so it stays picked. */
export const movedTo = (from: number, to: number): number => (to > from ? to - 1 : to);

export type LayoutId = 'title' | 'bullets' | 'section' | 'statement' | 'blank';
export interface Layout { id: LayoutId; name: string; make: () => Slide }

/** What a new slide starts as, as Keynote's master slides do: words to replace, and a style that suits the part. */
export const LAYOUTS: readonly Layout[] = [
  { id: 'title', name: 'Title', make: () => ({ ...blankSlide(), style: 'accent', kicker: 'Kicker', title: 'Presentation title' }) },
  { id: 'bullets', name: 'Title and bullets', make: () => ({ ...blankSlide(), title: 'Slide title', bullets: ['First point', 'Second point', 'Third point'] }) },
  { id: 'section', name: 'Section', make: () => ({ ...blankSlide(), style: 'dark', kicker: 'Part 2', title: 'Section title' }) },
  { id: 'statement', name: 'Statement', make: () => ({ ...blankSlide(), style: 'warm', title: 'One big idea, said plainly.' }) },
  { id: 'blank', name: 'Blank', make: () => blankSlide() },
];

/**
 * Which layout a slide reads as, for marking it in the inspector. A deck keeps no layout, so this goes by shape:
 * bullets make Title and bullets, a kicker over a title is a Section on dark and a Title otherwise, a title alone is a
 * Statement, and nothing at all is Blank. A slide with body text only matches none.
 */
export function layoutOf(slide: Slide): LayoutId | null {
  const has = (s: string) => s.trim().length > 0;
  const bullets = slide.bullets.some(has);
  if (bullets) return 'bullets';
  if (has(slide.text)) return null;
  if (has(slide.kicker) && has(slide.title)) return slide.style === 'dark' ? 'section' : 'title';
  if (has(slide.title)) return 'statement';
  if (!has(slide.kicker)) return 'blank';
  return null;
}

/** Elapsed time as the presenter's clock shows it: 4:05, or 1:02:09 past an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** The slide (from 0) that digits typed in Play name, or null when they name none. */
export function jumpTarget(digits: string, count: number): number | null {
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return n >= 1 && n <= count ? n - 1 : null;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** How long a deck runs, in whole minutes: its presenter notes read at 130 words a minute, and at least 30 s a slide. */
export function talkMinutes(slides: readonly Slide[]): number {
  const seconds = slides.reduce((sum, s) => sum + Math.max(30, (words(s.notes) / 130) * 60), 0);
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * A deck is Markdown, so any editor (and the agent) can read and write it:
 *
 *     <!-- style: dark -->
 *     ### Offsite 2027
 *     ## Lisbon, together
 *     - Three days, eight people
 *     Notes:
 *     Welcome everyone, 30 seconds.
 *     ---
 *     ## Next slide
 *
 * Slides are split by a line `---`. In each: an optional style comment, a `###` kicker above the title, the `#` or `##`
 * title, `-` bullets, other lines as text, and after `Notes:` the presenter notes.
 */
export type SlideStyle = 'light' | 'dark' | 'warm' | 'accent';
export const SLIDE_STYLES: SlideStyle[] = ['light', 'dark', 'warm', 'accent'];
export interface Slide { style: SlideStyle; kicker: string; title: string; bullets: string[]; text: string; notes: string }

export const blankSlide = (): Slide => ({ style: 'light', kicker: '', title: '', bullets: [], text: '', notes: '' });

export function parseSlide(chunk: string): Slide {
  const slide = blankSlide();
  const text: string[] = [];
  const notes: string[] = [];
  let inNotes = false;
  for (const raw of chunk.split('\n')) {
    const line = raw.trimEnd();
    if (inNotes) { notes.push(line); continue; }
    // An empty slide is written as this, so it is not lost between two lines of ---.
    if (/^<!--\s*slide\s*-->$/.test(line.trim())) continue;
    const style = /^<!--\s*style:\s*(\w+)\s*-->$/.exec(line.trim());
    if (style) { if ((SLIDE_STYLES as string[]).includes(style[1]!)) slide.style = style[1] as SlideStyle; continue; }
    if (/^notes:\s*/i.test(line.trim())) { inNotes = true; const rest = line.trim().replace(/^notes:\s*/i, ''); if (rest) notes.push(rest); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      const level = heading[1]!.length;
      if (level >= 3 && !slide.title && !slide.kicker) slide.kicker = heading[2]!.trim();
      else if (!slide.title) slide.title = heading[2]!.trim();
      else text.push(heading[2]!.trim());
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) { slide.bullets.push(bullet[1]!.trim()); continue; }
    text.push(line);
  }
  slide.text = text.join('\n').trim();
  slide.notes = notes.join('\n').trim();
  return slide;
}

export function parseDeck(markdown: string): Slide[] {
  const chunks = markdown.replace(/\r\n?/g, '\n').split(/\n---[ \t]*\n|^---[ \t]*\n|\n---[ \t]*$/);
  const slides = chunks.map((c) => c.trim()).filter((c) => c.length > 0).map(parseSlide);
  return slides.length > 0 ? slides : [blankSlide()];
}

export function writeSlide(slide: Slide): string {
  const lines: string[] = [];
  if (slide.style !== 'light') lines.push(`<!-- style: ${slide.style} -->`);
  if (slide.kicker.trim()) lines.push(`### ${slide.kicker.trim()}`);
  if (slide.title.trim()) lines.push(`## ${slide.title.trim()}`);
  for (const b of slide.bullets) if (b.trim()) lines.push(`- ${b.trim()}`);
  if (slide.text.trim()) lines.push('', slide.text.trim());
  if (slide.notes.trim()) lines.push('', 'Notes:', slide.notes.trim());
  return lines.length > 0 ? lines.join('\n') : '<!-- slide -->';
}

export const writeDeck = (slides: readonly Slide[]) => `${slides.map(writeSlide).join('\n\n---\n\n')}\n`;

/** Which slides of `after` are new or different from `before`, by position after lining up what is the same. */
export function changedSlides(before: readonly Slide[], after: readonly Slide[]): Set<number> {
  const key = (s: Slide) => writeSlide(s);
  const was = before.map(key);
  const out = new Set<number>();
  let j = 0;
  after.forEach((s, i) => {
    const k = key(s);
    const found = was.indexOf(k, j);
    if (found >= 0) j = found + 1; else out.add(i);
  });
  return out;
}

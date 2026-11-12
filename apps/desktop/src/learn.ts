import { APPS, type AppId } from './apps';

/**
 * Learn: Mobius's guide, read from the same pages as the repository's docs/ folder. Nothing here is written twice: a
 * lesson is a docs page (Start here, Working with Mobius) or one app's section of a docs/apps page (Your apps), so
 * keeping the docs current keeps Learn current. Only the user-facing folders are read; developer and design notes do
 * not ship in the app.
 */

export type LearnTopic = 'start' | 'apps' | 'guide';
export const TOPICS: readonly { id: LearnTopic | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'start', label: 'Start here' },
  { id: 'apps', label: 'Your apps' },
  { id: 'guide', label: 'Working with Mobius' },
];

export interface Lesson {
  id: string;
  topic: LearnTopic;
  title: string;
  /** The page's first sentence: what the lesson is about, for its card. */
  summary: string;
  /** The lesson itself, as Markdown the app's reader understands (no images, tables turned into lists). */
  body: string;
  /** For an app's lesson: the app it opens. */
  app?: AppId;
  /** For an app's lesson: what you can do there, from the bold lead-ins of its section's list. */
  can: string[];
  /** Where the lesson is written, from the repository's root: edit this to change the lesson. */
  source: string;
}

// Lessons in reading order. A page that is not named here still shows, after these.
const START_ORDER = ['install', 'first-run', 'tour'];
const GUIDE_ORDER = ['working-with-mobius', 'abilities', 'models-and-gateways', 'voice', 'memory-and-knowledge', 'privacy-and-profiles', 'keyboard-shortcuts', 'settings'];
const APP_PAGE_ORDER = ['assistant', 'browse-and-find', 'write-and-plan', 'create', 'review'];

/** The visible name of each app, to find its section; "Agent" is the Home app's section. */
const appByName = (name: string): AppId | undefined => APPS.find((a) => a.name.toLowerCase() === name.trim().toLowerCase())?.id;

/** The text of a docs page as Learn shows it: pictures left out (the app itself is beside it), tables as lists. */
export function readable(markdown: string): string {
  const out: string[] = [];
  let header: string[] | null = null;
  for (const line of markdown.split('\n')) {
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) continue;
    const row = /^\s*\|(.*)\|\s*$/.exec(line);
    if (!row) { header = null; out.push(line); continue; }
    const cells = row[1]!.split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (header === null) { header = cells; continue; }
    const [first, ...rest] = cells;
    const label = (first ?? '').replace(/^\[([^\]]+)\]\([^)]*\)$/, '$1');
    out.push(`- **${label.replace(/\*\*/g, '')}**${rest.filter(Boolean).length ? `: ${rest.filter(Boolean).join(' · ')}` : ''}`);
  }
  // Links between docs pages make sense in the repository, not in the app: they read as their words.
  return out.join('\n').replace(/\[([^\]\n]+)\]\((?!https?:|mailto:)[^)\s]+\)/g, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

/** The first sentence of a page's first paragraph, without formatting. */
export function firstSentence(markdown: string): string {
  const para = markdown.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|[-*] |\d+\. |>|\||!\[|```)/.test(p)) ?? '';
  const plain = para.replace(/\n/g, ' ').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const end = /^(.+?[.!?])(\s|$)/.exec(plain);
  return (end ? end[1]! : plain).trim();
}

/** What an app can do: the bold lead-in of each item in its section's lists, "**Smart lists**: …" → "Smart lists". */
export function capabilities(markdown: string): string[] {
  const found: string[] = [];
  for (const m of markdown.matchAll(/^\s*[-*] \*\*([^*\n]+?)\*\*/gm)) {
    const name = m[1]!.replace(/[.:]\s*$/, '').trim();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ordered = (order: string[], name: string) => { const at = order.indexOf(name); return at === -1 ? order.length : at; };

/**
 * Every lesson, from docs pages keyed by their path from the repository's root ("docs/guide/voice.md"). Pure, so the
 * tests can give it pages of their own.
 */
export function buildLessons(pages: Record<string, string>): Lesson[] {
  const start: Lesson[] = [];
  const guide: Lesson[] = [];
  const apps: { order: number; lesson: Lesson }[] = [];
  const entries = Object.entries(pages).map(([path, text]) => [path.replace(/^(\.\.\/)+/, ''), text.replace(/\r\n/g, '\n')] as const);
  for (const [path, text] of entries) {
    const m = /^docs\/(getting-started|guide|apps)\/([^/]+)\.md$/.exec(path);
    if (!m) continue;
    const [, folder, name] = m as unknown as [string, string, string];
    if (folder === 'apps') {
      if (name === 'README') continue;
      // One lesson per app: each "## Name" section of a group page.
      const parts = text.split(/^## /m).slice(1);
      parts.forEach((part, index) => {
        const nl = part.indexOf('\n');
        const title = (nl === -1 ? part : part.slice(0, nl)).trim();
        const body = nl === -1 ? '' : part.slice(nl + 1);
        const app = appByName(title);
        apps.push({
          // By group page, then by place on the page.
          order: ordered(APP_PAGE_ORDER, name) * 100 + index,
          lesson: {
            id: `apps/${slug(title)}`, topic: 'apps', title, summary: firstSentence(body), body: readable(body), can: capabilities(body),
            source: `${path}#${slug(title)}`, ...(app ? { app } : {}),
          },
        });
      });
      continue;
    }
    const titleLine = /^# (.+)$/m.exec(text);
    const title = titleLine ? titleLine[1]!.trim() : name;
    const body = titleLine ? text.slice(titleLine.index + titleLine[0].length) : text;
    const lesson: Lesson = { id: `${folder === 'guide' ? 'guide' : 'start'}/${name}`, topic: folder === 'guide' ? 'guide' : 'start', title, summary: firstSentence(body), body: readable(body), can: [], source: path };
    (folder === 'guide' ? guide : start).push(lesson);
  }
  const byOrder = (order: string[]) => (a: Lesson, b: Lesson) => ordered(order, a.id.split('/')[1]!) - ordered(order, b.id.split('/')[1]!) || a.title.localeCompare(b.title);
  start.sort(byOrder(START_ORDER));
  guide.sort(byOrder(GUIDE_ORDER));
  apps.sort((a, b) => a.order - b.order);
  return [...start, ...apps.map((a) => a.lesson), ...guide];
}

/** The apps that have no lesson yet: their docs section is missing, or named differently from the app. */
export const appsWithoutLesson = (lessons: readonly Lesson[], ids: readonly AppId[] = APPS.filter((a) => a.available).map((a) => a.id)): AppId[] =>
  ids.filter((id) => !lessons.some((l) => l.app === id));

/** The lessons that match what was typed, in their title, summary, what they can do and their text. */
export function searchLessons(lessons: readonly Lesson[], topic: LearnTopic | 'all', query: string): Lesson[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return lessons.filter((l) => (topic === 'all' || l.topic === topic) && words.every((w) => `${l.title} ${l.summary} ${l.can.join(' ')} ${l.body}`.toLowerCase().includes(w)));
}

/** Where a lesson is edited on GitHub, for "Suggest a change". */
export const editUrl = (lesson: Lesson): string => `https://github.com/BevActual/mobius/edit/main/${lesson.source.replace(/#.*$/, '')}`;

/** The docs pages themselves, bundled with the app: user-facing folders only. */
const bundled = import.meta.glob(['../../../docs/getting-started/*.md', '../../../docs/guide/*.md', '../../../docs/apps/*.md'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const LESSONS: readonly Lesson[] = buildLessons(bundled);

import { writeDesign, type DesignDoc } from '../design-format';

/** The preview's Design app: designs kept in memory while the preview is open, so the canvas can be used without the core. */
const now = Date.now();
const t = (id: string, name: string, x: number, y: number, w: number, h: number, text: string, size: number, weight: number, color: string, align: 'left' | 'center' = 'left') =>
  ({ id, type: 'text' as const, name, x, y, w, h, fill: 'transparent', radius: 0, opacity: 1, text, size, weight, color, align });
const r = (id: string, name: string, x: number, y: number, w: number, h: number, fill: string, radius = 0, type: 'rect' | 'ellipse' = 'rect') =>
  ({ id, type, name, x, y, w, h, fill, radius, opacity: 1, text: '', size: 16, weight: 400, color: '#1d1d1f', align: 'left' as const });
const HOME: DesignDoc = {
  version: 1,
  styles: [{ name: 'Primary', color: '#5856d6' }, { name: 'Ink', color: '#1d1d1f' }, { name: 'Muted', color: '#6e6e73' }],
  frames: [
    { id: 'f1', name: 'Home', x: 0, y: 0, w: 393, h: 852, fill: '#ffffff', radius: 0, children: [
      t('n1', 'Title', 24, 96, 345, 40, 'Lisbon offsite', 32, 700, 'style:Ink'),
      t('n2', 'Dates', 24, 140, 345, 24, '23 to 26 June · 14 people', 16, 400, 'style:Muted'),
      r('n3', 'Hero', 24, 188, 345, 220, '#e9e8ff', 20),
      r('n4', 'Sun', 268, 214, 72, 72, '#ffcc00', 0, 'ellipse'),
      t('n5', 'Section', 24, 440, 345, 28, 'Plan', 22, 700, 'style:Ink'),
      r('n6', 'Card 1', 24, 480, 345, 76, '#f2f2f7', 14),
      r('n7', 'Card 2', 24, 568, 345, 76, '#f2f2f7', 14),
      r('n8', 'Button', 24, 760, 345, 52, 'style:Primary', 14),
      t('n9', 'Button label', 24, 774, 345, 24, 'Book the flights', 17, 600, '#ffffff', 'center'),
    ] },
    { id: 'f2', name: 'Trip detail', x: 473, y: 0, w: 393, h: 852, fill: '#f9f9fb', radius: 0, children: [
      t('n10', 'Heading', 24, 96, 345, 36, 'Day one', 28, 700, 'style:Ink'),
      r('n11', 'Map', 24, 150, 345, 260, '#dfe9f5', 16),
    ] },
  ],
};
const TEXT: Record<string, string> = { 'Trip app/Home.json': writeDesign(HOME) };
const MODIFIED: Record<string, number> = { 'Trip app/Home.json': now - 3_600_000 };
const title = (path: string) => path.slice(path.indexOf('/') + 1, -5);

export const PREVIEW_DESIGNS: Record<string, (...args: never[]) => unknown> = {
  'designs.list': () => [{ name: 'Trip app', pages: Object.keys(TEXT).map((path) => ({ path, title: title(path), modified: MODIFIED[path] ?? now })) }],
  'designs.read': ((path: string) => (path in TEXT ? { path, content: TEXT[path], modified: MODIFIED[path] ?? now } : { ok: false, message: 'that design is not there' })) as never,
  'designs.save': ((path: string, content: string) => { TEXT[path] = content; MODIFIED[path] = Date.now(); return { path, modified: MODIFIED[path] }; }) as never,
  'designs.createPage': ((folder: string, name?: string) => {
    const path = `${folder}/${(name ?? '').trim() || 'Untitled design'}.json`;
    TEXT[path] = writeDesign({ version: 1, styles: [], frames: [{ id: 'f1', name: 'Frame 1', x: 0, y: 0, w: 393, h: 852, fill: '#ffffff', radius: 0, children: [] }] });
    MODIFIED[path] = Date.now();
    return { path, content: TEXT[path], modified: MODIFIED[path] };
  }) as never,
  'designs.remove': ((path: string) => { delete TEXT[path]; return { path }; }) as never,
};

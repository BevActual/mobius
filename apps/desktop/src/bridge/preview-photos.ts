/** The preview's Photo app: two albums of pictures drawn when first asked for, with edits kept in memory while it is open. */
type Scene = { sky: [string, string]; ground: [string, string]; sun: string; sunAt: [number, number]; hills: number; water?: boolean };
const SCENES: Record<string, Scene> = {
  'Lisbon/Coastline.jpg': { sky: ['#5d8fd6', '#cfe3f5'], ground: ['#2f6f8f', '#173f55'], sun: '#fff4c2', sunAt: [0.72, 0.25], hills: 0.62, water: true },
  'Lisbon/Alfama at dusk.jpg': { sky: ['#3b2a63', '#f09a5b'], ground: ['#5a3b4c', '#24161f'], sun: '#ffd27a', sunAt: [0.3, 0.55], hills: 0.66 },
  'Lisbon/Belém.jpg': { sky: ['#8fb8e8', '#e8f1fb'], ground: ['#c8b28a', '#8a7552'], sun: '#ffffff', sunAt: [0.2, 0.2], hills: 0.7 },
  'Lisbon/Sintra hills.jpg': { sky: ['#9cc1df', '#dfeaf3'], ground: ['#4e7a3c', '#22401b'], sun: '#fffbe0', sunAt: [0.82, 0.18], hills: 0.5 },
  'Lisbon/Tram 28.jpg': { sky: ['#6aa0d8', '#bcd8f0'], ground: ['#d9a62e', '#7b5a12'], sun: '#fff7d6', sunAt: [0.5, 0.15], hills: 0.74 },
  'Kestrel P2/Workshop.jpg': { sky: ['#30343b', '#5b616b'], ground: ['#43474e', '#1d2024'], sun: '#ffe9b0', sunAt: [0.5, 0.2], hills: 0.68 },
  'Kestrel P2/Test track.jpg': { sky: ['#7fa7cf', '#d5e4f1'], ground: ['#5c6168', '#2b2e33'], sun: '#ffffff', sunAt: [0.15, 0.3], hills: 0.58 },
};
const MODIFIED = Date.now() - 3 * 86_400_000;
const EDITS: Record<string, string> = {
  'Lisbon/Alfama at dusk.jpg': '{\n  "version": 1,\n  "adjustments": [\n    {"id":"a1","name":"Warm the roofs","warmth":30,"saturation":12,"area":{"kind":"below","at":0.6,"soft":0.2}}\n  ]\n}\n',
};
const EDITED: Record<string, number> = { 'Lisbon/Alfama at dusk.jpg': MODIFIED };
const PICTURES: Record<string, string> = {};

function paint(s: Scene): string {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 800;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, c.height * s.hills);
  sky.addColorStop(0, s.sky[0]); sky.addColorStop(1, s.sky[1]);
  g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = s.sun; g.beginPath(); g.arc(c.width * s.sunAt[0], c.height * s.sunAt[1], 60, 0, Math.PI * 2); g.fill();
  const ground = g.createLinearGradient(0, c.height * s.hills, 0, c.height);
  ground.addColorStop(0, s.ground[0]); ground.addColorStop(1, s.ground[1]);
  g.fillStyle = ground;
  g.beginPath(); g.moveTo(0, c.height);
  for (let x = 0; x <= c.width; x += 20) g.lineTo(x, c.height * s.hills + Math.sin(x / 140) * 34 + Math.sin(x / 47) * 9);
  g.lineTo(c.width, c.height); g.fill();
  if (s.water) { g.fillStyle = 'rgba(255,255,255,0.18)'; for (let y = c.height * 0.75; y < c.height; y += 18) g.fillRect(0, y, c.width, 2); }
  return c.toDataURL('image/jpeg', 0.9);
}

/** The library as the preview keeps it: each album's photos (their paths), and what each path shows. */
const SHOWS: Record<string, string> = Object.fromEntries(Object.keys(SCENES).map((p) => [p, p]));
const ALBUMS = new Map<string, string[]>();
for (const p of Object.keys(SCENES)) { const a = p.split('/')[0]!; ALBUMS.set(a, [...(ALBUMS.get(a) ?? []), p]); }
const BIN = new Map<string, { from: string; shows: string }>();
const nameOf = (p: string) => p.slice(p.indexOf('/') + 1);
function free(album: string, name: string, taken: (p: string) => boolean): string {
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  let chosen = name;
  for (let n = 2; taken(`${album}/${chosen}`); n++) chosen = `${stem} ${n}${ext}`;
  return `${album}/${chosen}`;
}
const inAlbum = (p: string) => ALBUMS.get(p.split('/')[0]!)?.includes(p) ?? false;
function moveTo(path: string, to: string) {
  const from = path.split('/')[0]!;
  ALBUMS.set(from, (ALBUMS.get(from) ?? []).filter((p) => p !== path));
  const album = to.split('/')[0]!;
  ALBUMS.set(album, [...(ALBUMS.get(album) ?? []), to].sort((a, b) => a.localeCompare(b)));
  SHOWS[to] = SHOWS[path]!;
  if (path in EDITS) { EDITS[to] = EDITS[path]!; EDITED[to] = EDITED[path]!; delete EDITS[path]; delete EDITED[path]; }
  if (to !== path) delete SHOWS[path];
}
const read = (path: string, shows: string | undefined) => {
  const scene = shows ? SCENES[shows] : undefined;
  if (!scene || !shows) return { ok: false, message: 'that photo is not there' };
  PICTURES[shows] ??= paint(scene);
  return { path, dataUrl: PICTURES[shows], edits: EDITS[path] ?? null, modified: MODIFIED, editsModified: EDITED[path] ?? null };
};

const albums = () => [...ALBUMS.keys()].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, photos: (ALBUMS.get(name) ?? []).map((path) => ({ path, name: nameOf(path), modified: MODIFIED, edited: path in EDITS })) }));

export const PREVIEW_PHOTOS: Record<string, (...args: never[]) => unknown> = {
  'photos.albums': () => albums(),
  'photos.createAlbum': ((name: string) => { let n = name || 'Album'; for (let i = 2; ALBUMS.has(n); i++) n = `${name} ${i}`; ALBUMS.set(n, []); return { name: n }; }) as never,
  'photos.read': ((path: string) => read(path, inAlbum(path) ? SHOWS[path] : undefined)) as never,
  'photos.saveEdits': ((path: string, text: string) => { EDITS[path] = text; EDITED[path] = Date.now(); (window as unknown as { savedEdits?: string }).savedEdits = text; return { path, editsModified: EDITED[path] }; }) as never,
  'photos.export': ((path: string) => ({ path: path.replace(/\.[^.]+$/, ' edited.jpg') })) as never,
  'photos.rename': ((path: string, name: string) => {
    if (!inAlbum(path)) return { ok: false, message: 'that photo is not there' };
    const ext = path.slice(path.lastIndexOf('.'));
    const wanted = /\.(jpe?g|png|webp|gif)$/i.test(name) ? name.trim() : `${name.trim()}${ext}`;
    if (wanted === nameOf(path)) return { path };
    const to = free(path.split('/')[0]!, wanted, inAlbum);
    moveTo(path, to);
    return { path: to };
  }) as never,
  'photos.move': ((path: string, album: string) => {
    if (!inAlbum(path) || !ALBUMS.has(album)) return { ok: false, message: 'that album is not there' };
    if (path.startsWith(`${album}/`)) return { path };
    const to = free(album, nameOf(path), inAlbum);
    moveTo(path, to);
    return { path: to };
  }) as never,
  'photos.delete': ((path: string) => {
    if (!inAlbum(path)) return { ok: false, message: 'that photo is not there' };
    const album = path.split('/')[0]!;
    const to = free(album, nameOf(path), (p) => BIN.has(p));
    BIN.set(to, { from: path, shows: SHOWS[path]! });
    ALBUMS.set(album, (ALBUMS.get(album) ?? []).filter((p) => p !== path));
    if (path in EDITS) { EDITS[`.deleted/${to}`] = EDITS[path]!; delete EDITS[path]; delete EDITED[path]; }
    return { path, deleted: to };
  }) as never,
  'photos.deleted': () => [...BIN.keys()].map((path) => ({ path, name: nameOf(path), album: path.split('/')[0], modified: MODIFIED, edited: `.deleted/${path}` in EDITS })),
  'photos.readDeleted': ((path: string) => { const r = read(path, BIN.get(path)?.shows); return 'dataUrl' in r ? { ...r, edits: EDITS[`.deleted/${path}`] ?? null } : r; }) as never,
  'photos.recover': ((path: string) => {
    const got = BIN.get(path);
    if (!got) return { ok: false, message: 'that photo is not in Recently Deleted' };
    const album = path.split('/')[0]!;
    if (!ALBUMS.has(album)) ALBUMS.set(album, []);
    const to = free(album, nameOf(path), inAlbum);
    BIN.delete(path);
    SHOWS[to] = got.shows;
    ALBUMS.set(album, [...ALBUMS.get(album)!, to].sort((a, b) => a.localeCompare(b)));
    if (`.deleted/${path}` in EDITS) { EDITS[to] = EDITS[`.deleted/${path}`]!; EDITED[to] = Date.now(); delete EDITS[`.deleted/${path}`]; }
    return { path: to };
  }) as never,
  'photos.emptyDeleted': () => { BIN.clear(); return { emptied: true }; },
  'photos.renameAlbum': ((album: string, name: string) => {
    if (!ALBUMS.has(album)) return { ok: false, message: 'that album is not there' };
    let n = name.trim() || album;
    if (n === album) return { name: album };
    for (let i = 2; ALBUMS.has(n); i++) n = `${name.trim()} ${i}`;
    for (const p of [...ALBUMS.get(album)!]) moveTo(p, `${n}/${nameOf(p)}`);
    ALBUMS.delete(album);
    return { name: n };
  }) as never,
  'photos.deleteAlbum': ((album: string) => {
    const list = ALBUMS.get(album);
    if (!list) return { ok: false, message: 'that album is not there' };
    for (const p of [...list]) PREVIEW_PHOTOS['photos.delete']!(p as never);
    ALBUMS.delete(album);
    return { name: album, deleted: list.length };
  }) as never,
};

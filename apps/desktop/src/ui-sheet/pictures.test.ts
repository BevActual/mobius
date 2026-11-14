import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Every card on the reference sheet has a picture in docs/developers/ui/img, and every picture is on a group page.
// A failure here means: run `npm run ui-shots -w @mobius/desktop -- <shot>` and show the picture on its page.
const sheet = readFileSync(resolve(__dirname, 'Sheet.tsx'), 'utf8');
const docs = resolve(__dirname, '../../../../docs/developers/ui');
const shots = [...sheet.matchAll(/<Card\b[^>]*\bshot="([^"]+)"/g)].map((m) => m[1]!);
const pages = readdirSync(docs).filter((f) => f.endsWith('.md')).map((f) => readFileSync(resolve(docs, f), 'utf8')).join('\n');

describe('component library pictures', () => {
  it('names every card on the sheet once', () => {
    expect(shots.length).toBe((sheet.match(/<Card\b/g) ?? []).length);
    expect(new Set(shots).size).toBe(shots.length);
  });

  it.each(shots)('has a picture of %s on a group page', (shot) => {
    expect(existsSync(resolve(docs, 'img', `${shot}.png`)), `docs/developers/ui/img/${shot}.png is missing`).toBe(true);
    expect(pages, `no page in docs/developers/ui shows img/${shot}.png`).toContain(`(img/${shot}.png)`);
  });

  it('keeps no picture of a card that is gone', () => {
    const pictures = readdirSync(resolve(docs, 'img')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
    expect(pictures.filter((p) => !shots.includes(p))).toEqual([]);
  });
});

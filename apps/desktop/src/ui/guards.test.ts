import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Guards for the shared controls. Menus come from src/ui, not hand-drawn in each app; and the shared controls' look
 * uses only the values in tokens.css. Each kind of control joins the first guard once src/ui offers it.
 */

const ui = path.dirname(fileURLToPath(import.meta.url));
const src = path.dirname(ui);

function walk(dir: string, ext: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, ext);
    return entry.name.endsWith(ext) ? [full] : [];
  });
}
const rel = (file: string) => path.relative(src, file).split(path.sep).join('/');

/**
 * Files that still draw a menu of their own. This list only shrinks: when a file moves to ui/Menu, take it off.
 * Nothing new joins it; a new menu uses ui/Menu (Menu from a button, PointMenu at a point).
 */
const OWN_MENUS = [
  'ChatPanel.tsx', 'MenuBar.tsx', 'SelectionMenu.tsx',
  'composer/PopMenu.tsx',
];

describe('menus come from src/ui', () => {
  const drawn = walk(src, '.tsx')
    .filter((file) => !rel(file).startsWith('ui/'))
    // A JSX attribute (` role="menu"`), not a selector string such as `closest('[role="menu"]')`.
    .filter((file) => /\srole=\{?["']menu["']/.test(fs.readFileSync(file, 'utf8')))
    .map(rel)
    .sort();

  it('no new file draws its own role="menu" (use Menu or PointMenu from ./ui)', () => {
    expect(drawn.filter((file) => !OWN_MENUS.includes(file))).toEqual([]);
  });

  it('a file that moved to ui/Menu is taken off the list of files with their own menus', () => {
    expect(OWN_MENUS.filter((file) => !drawn.includes(file))).toEqual([]);
  });
});

describe('the shared controls use only the tokens', () => {
  const sheets = walk(ui, '.css');

  it('names no colour of its own (no #hex, rgb(), hsl(): use a colour token)', () => {
    const found = sheets.flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)].map((m) => `${rel(file)}: ${m[0]}`));
    expect(found).toEqual([]);
  });

  it('names no size of its own (no px: use a space, size or radius token)', () => {
    const found = sheets.flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/(?<![\w-])\d*\.?\d+px\b/g)].map((m) => `${rel(file)}: ${m[0]}`));
    expect(found).toEqual([]);
  });
});

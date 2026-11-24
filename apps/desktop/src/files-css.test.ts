import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Files in the panel look (docs/design/panel-look.md): rows float on the panel, and side lists use 28px rows. */
const here = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readFileSync(path.join(here, 'files.css'), 'utf8');
const styles = fs.readFileSync(path.join(here, 'styles.css'), 'utf8');
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('Files in the panel look', () => {
  it('draws no line between rows or under the header', () => {
    expect(rule(files, '.files-row')).not.toMatch(/border-bottom/);
    expect(rule(files, '.files-head')).not.toMatch(/border-bottom/);
  });
  it('marks a folder holding Mobius\'s work in grey, not with an indigo dot', () => {
    expect(files).not.toMatch(/\.files-dot/);
    expect(rule(files, '.files-held')).toMatch(/color: var\(--muted\)/);
  });
  it('gives side lists 28px rows', () => {
    expect(styles).toMatch(/\.ui-dock\[data-dock="left"\] :is\(\.list-row[^{]*\{ min-height: var\(--row-side-panel, 28px\)/);
  });
});

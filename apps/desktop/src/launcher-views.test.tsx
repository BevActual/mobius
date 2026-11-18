import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GRID_COLS, Launcher, everyApp, marked, stepFrom, type LauncherItem } from './Launcher';

const base = { open: true, onClose: () => {}, tabs: [], onNewTab: () => {}, onActivateTab: () => {}, onOpenApp: () => {}, inline: true, recent: [], onOpenMobius: () => {} };

describe('launcher views', () => {
  it('ends the pinned row with All apps, and labels its sections in sentence case', () => {
    const html = renderToStaticMarkup(<Launcher {...base} pinned={['mail', 'notes']} places={{ abilities: () => {} }} />);
    expect(html).toMatch(/data-kind="pinned"[^>]*>.*Mail.*Notes.*All apps/s);
    expect(html).toContain('>Pinned<');
    expect(html).not.toContain('Right-click an app to pin');
  });

  it('shows every app A to Z in All apps, then Add apps', () => {
    const html = renderToStaticMarkup(<Launcher {...base} startIn="apps" pinned={['mail']} places={{ abilities: () => {} }} />);
    const names = [...html.matchAll(/class="launcher-tile-name">([^<]+)</g)].map((m) => m[1]);
    expect(names.at(-1)).toBe('Add apps');
    const apps = names.slice(0, -1);
    expect(apps).toEqual([...apps].sort((a, b) => a!.localeCompare(b!)));
    expect(apps.length).toBe(everyApp().length);
    expect(html).toContain('placeholder="Find an app"');
    expect(html).toContain('>Back<');
  });

  it('moves through All apps as a grid', () => {
    const kinds: LauncherItem['kind'][] = Array.from({ length: GRID_COLS * 2 + 1 }, () => 'grid');
    expect(stepFrom(kinds, 0, 'ArrowRight')).toBe(1);
    expect(stepFrom(kinds, 1, 'ArrowDown')).toBe(GRID_COLS + 1);
    expect(stepFrom(kinds, GRID_COLS + 1, 'ArrowDown')).toBe(GRID_COLS * 2);
    expect(stepFrom(kinds, GRID_COLS - 1, 'ArrowRight')).toBe(GRID_COLS - 1);
  });

  it('marks the typed letters in a name', () => {
    expect(renderToStaticMarkup(<>{marked('Calendar', 'len')}</>)).toBe('Ca<mark class="launcher-match">len</mark>dar');
    expect(marked('Mail', 'x')).toBe('Mail');
  });
});

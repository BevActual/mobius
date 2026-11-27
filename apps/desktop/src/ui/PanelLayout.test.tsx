import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOCK_KEYS, DOCK_SIZE, PanelLayout, atLeast, clampDock, dockAt, panelShape, dockPlaces, parseLayout, placedPanels, pressIs, type PanelSpec } from './PanelLayout';

const press = (key: string, over: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });

describe('panels', () => {
  it('draw the shown ones in their docks, each with its name and a close button, and leave hidden ones out', () => {
    const html = renderToStaticMarkup(
      <PanelLayout app="test" panels={[
        { id: 'notes', name: 'Speaker notes', dock: 'bottom', shown: true, render: () => <p>Say hello</p> },
        { id: 'details', name: 'Details', dock: 'right', render: () => <p>Hidden</p> },
      ]}>
        <p>Content</p>
      </PanelLayout>,
    );
    expect(html).toContain('<div class="ui-panels-content"><p>Content</p></div>');
    expect(html).toContain('data-dock="bottom"');
    expect(html).toContain('aria-label="Speaker notes"');
    expect(html).toContain('aria-label="Hide Speaker notes"');
    expect(html).toContain(`height:${DOCK_SIZE.bottom.initial}px`);
    expect(html).not.toContain('Hidden');
    expect(html).not.toContain('data-dock="right"');
  });

  it('always draw a fixed panel, even when a layout kept from before hid it, with no button to hide it', () => {
    const was = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: () => JSON.stringify({ shown: { list: false } }) } };
    try {
      const html = renderToStaticMarkup(
        <PanelLayout app="settings" panels={[{ id: 'list', name: 'Settings', dock: 'left', fixed: true, render: () => <nav>Sections</nav> }]}>
          <p>Content</p>
        </PanelLayout>,
      );
      expect(html).toContain('<nav>Sections</nav>');
      expect(html).not.toContain('Hide Settings');
    } finally {
      (globalThis as { window?: unknown }).window = was;
    }
  });

  it('draw a left dock before the content, its edge after its panels', () => {
    const html = renderToStaticMarkup(
      <PanelLayout app="test" panels={[{ id: 'places', name: 'Places', dock: 'left', shown: true, render: () => <p>Inbox</p> }]}>
        <p>Content</p>
      </PanelLayout>,
    );
    expect(html.indexOf('data-dock="left"')).toBeLessThan(html.indexOf('ui-panels-content'));
    expect(html).toContain(`width:${DOCK_SIZE.left.initial}px`);
    expect(html).toContain('aria-label="Resize the panels on the left"');
  });

  it('put panels that share a group in one place with tabs, the first in front unless another was kept there', () => {
    const p = (id: string, group?: string): PanelSpec => ({ id, name: id[0]!.toUpperCase() + id.slice(1), dock: 'bottom', shown: true, ...(group ? { group } : {}), render: () => <p>{`Body of ${id}`}</p> });
    const all = [p('terminal', 'run'), p('notes'), p('tests', 'run'), p('problems', 'run')];
    const places = dockPlaces(all);
    expect(places.map((x) => x.key)).toEqual(['group:run', 'notes']);
    expect(places[0]!.panels.map((x) => x.id)).toEqual(['terminal', 'tests', 'problems']);
    expect(places[0]!.front.id).toBe('terminal');
    expect(dockPlaces(all, { run: 'tests' })[0]!.front.id).toBe('tests');
    expect(dockPlaces(all, { run: 'gone' })[0]!.front.id).toBe('terminal');

    const html = renderToStaticMarkup(<PanelLayout app="test" panels={all}><p>Content</p></PanelLayout>);
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Terminal</);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Tests</);
    expect(html).toContain('Body of terminal');
    expect(html).not.toContain('Body of tests');
    expect(html).toContain('aria-label="Hide Terminal, Tests, Problems"');
    expect(html).toContain('<h2 class="ui-panel-name">Notes</h2>');
  });

  it('draw a group with one panel shown as a plain panel, its name and close', () => {
    const html = renderToStaticMarkup(
      <PanelLayout app="test" panels={[
        { id: 'layers', name: 'Layers', dock: 'left', group: 'side', shown: true, render: () => <p>Frame 1</p> },
        { id: 'assets', name: 'Assets', dock: 'left', group: 'side', render: () => <p>Icons</p> },
      ]}><p>Content</p></PanelLayout>,
    );
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('<h2 class="ui-panel-name">Layers</h2>');
    expect(html).not.toContain('Icons');
  });

  it('show or hide a whole dock with its key: Ctrl+\\ the left, Ctrl+Alt+\\ the right, Ctrl+J the bottom', () => {
    expect(pressIs(DOCK_KEYS.left, press('\\', { ctrlKey: true }), false)).toBe(true);
    expect(pressIs(DOCK_KEYS.left, press('\\', { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(pressIs(DOCK_KEYS.right, press('\\', { ctrlKey: true, altKey: true }), false)).toBe(true);
    expect(pressIs(DOCK_KEYS.bottom, press('j', { metaKey: true }), true)).toBe(true);
  });

  it('keep each dock within its range: the right 280 to 560, the bottom at least 120 and at most 70% of the content', () => {
    expect(clampDock('left', 100)).toBe(DOCK_SIZE.left.min);
    expect(clampDock('left', 900)).toBe(DOCK_SIZE.left.max);
    expect(clampDock('right', 100)).toBe(280);
    expect(clampDock('right', 900)).toBe(560);
    expect(clampDock('bottom', 50, 1000)).toBe(120);
    expect(clampDock('bottom', 900, 1000)).toBe(700);
  });

  it('read a kept layout, and treat anything unreadable as nothing kept', () => {
    expect(parseLayout('{"shown":{"a":true,"b":"x"},"size":{"right":400,"bottom":"tall"}}')).toEqual({ shown: { a: true }, size: { right: 400 } });
    expect(parseLayout('{"shown":{},"size":{"left":300}}')).toEqual({ shown: {}, size: { left: 300 } });
    expect(parseLayout('{"shown":{},"size":{},"front":{"run":"tests","bad":3}}')).toEqual({ shown: {}, size: {}, front: { run: 'tests' } });
    expect(parseLayout('{"shown":{},"size":{},"dock":{"outline":"left","x":"top"}}')).toEqual({ shown: {}, size: {}, dock: { outline: 'left' } });
    expect(parseLayout('not json')).toEqual({ shown: {}, size: {} });
    expect(parseLayout(null)).toEqual({ shown: {}, size: {} });
  });

  it('put a moved panel in the dock it was moved to, except a fixed one, and draw it there', () => {
    const outline: PanelSpec = { id: 'outline', name: 'Outline', dock: 'right', shown: true, render: () => <p>Symbols</p> };
    const list: PanelSpec = { id: 'list', name: 'Sections', dock: 'left', fixed: true, render: () => <p>List</p> };
    const placed = placedPanels([outline, list], { outline: 'bottom', list: 'right' });
    expect(placed.map((p) => p.dock)).toEqual(['bottom', 'left']);
    expect(placed[1]).toBe(list);
    const was = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { localStorage: { getItem: () => JSON.stringify({ shown: {}, size: {}, dock: { outline: 'left' } }) } };
    try {
      const html = renderToStaticMarkup(<PanelLayout app="code" panels={[outline]}><p>Content</p></PanelLayout>);
      expect(html).toContain('data-dock="left"');
      expect(html).not.toContain('data-dock="right"');
    } finally {
      (globalThis as { window?: unknown }).window = was;
    }
  });

  it('take a panel dragged near the page\'s sides or bottom to that dock, and anywhere else to none', () => {
    const page = { left: 0, top: 0, width: 1000, height: 800 };
    expect(dockAt(40, 400, page)).toBe('left');
    expect(dockAt(960, 400, page)).toBe('right');
    expect(dockAt(500, 770, page)).toBe('bottom');
    expect(dockAt(500, 300, page)).toBeNull();
    expect(dockAt(150, 400, page)).toBeNull();
    expect(dockAt(-5, 300, page)).toBeNull();
  });

  it('know the shape of a panel\'s room, and keep a dock wide enough for what its panels need', () => {
    expect(panelShape(180, 600)).toBe('narrow');
    expect(panelShape(300, 700)).toBe('column');
    expect(panelShape(1000, 260)).toBe('strip');
    expect(panelShape(600, 500)).toBe('column');
    const wide: PanelSpec = { id: 'w', name: 'W', dock: 'left', min: { width: 300 }, render: () => null };
    expect(atLeast('left', [wide], 248)).toBe(300);
    expect(atLeast('left', [wide], 360)).toBe(360);
    expect(atLeast('left', [{ ...wide, min: { width: 900 } }], 248)).toBe(DOCK_SIZE.left.max);
  });

  it('match keys with mod as Control (or Command on a Mac), and nothing extra held', () => {
    expect(pressIs('mod+j', press('j', { ctrlKey: true }), false)).toBe(true);
    expect(pressIs('mod+j', press('j', { metaKey: true }), true)).toBe(true);
    expect(pressIs('mod+j', press('j', { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(pressIs('mod+shift+o', press('O', { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(pressIs('mod+j', press('j'), false)).toBe(false);
  });
});

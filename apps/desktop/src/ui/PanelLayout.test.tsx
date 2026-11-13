import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOCK_SIZE, PanelLayout, clampDock, parseLayout, pressIs } from './PanelLayout';

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

  it('keep each dock within its range: the right 280 to 560, the bottom at least 120 and at most 70% of the content', () => {
    expect(clampDock('right', 100)).toBe(280);
    expect(clampDock('right', 900)).toBe(560);
    expect(clampDock('bottom', 50, 1000)).toBe(120);
    expect(clampDock('bottom', 900, 1000)).toBe(700);
  });

  it('read a kept layout, and treat anything unreadable as nothing kept', () => {
    expect(parseLayout('{"shown":{"a":true,"b":"x"},"size":{"right":400,"bottom":"tall"}}')).toEqual({ shown: { a: true }, size: { right: 400 } });
    expect(parseLayout('not json')).toEqual({ shown: {}, size: {} });
    expect(parseLayout(null)).toEqual({ shown: {}, size: {} });
  });

  it('match keys with mod as Control (or Command on a Mac), and nothing extra held', () => {
    expect(pressIs('mod+j', press('j', { ctrlKey: true }), false)).toBe(true);
    expect(pressIs('mod+j', press('j', { metaKey: true }), true)).toBe(true);
    expect(pressIs('mod+j', press('j', { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(pressIs('mod+shift+o', press('O', { ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(pressIs('mod+j', press('j'), false)).toBe(false);
  });
});

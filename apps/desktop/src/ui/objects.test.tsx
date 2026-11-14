import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObjectCard, ObjectChip, ObjectRow, type Thing } from './Objects';
import { XYPad } from './XYPad';

const noop = () => {};
const task: Thing = { kind: 'task', title: 'Pay the Veltro deposit', list: { name: 'P2 build', color: 'teal' }, flagged: true, due: 'Yesterday', overdue: true, from: 'Mail · Veltro Cells' };
const mail: Thing = { kind: 'mail', from: 'Priya Nair', subject: 'P2 build dates', preview: 'Can you confirm', unread: true, when: '9:32 PM' };
const file: Thing = { kind: 'file', name: 'P2 budget', type: 'sheet', app: 'Sheets', folder: 'P2 build', changed: '3 hr ago', byMobius: true, change: '2 cells in Sheet 1' };

describe('shared objects', () => {
  it('draws a task row with a check that ticks it, and an overdue date in red', () => {
    const html = renderToStaticMarkup(<ObjectRow thing={task} onOpen={noop} onToggle={noop} />);
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('aria-label="Complete “Pay the Veltro deposit”"');
    expect(html).toContain('data-tone="red">Yesterday');
    expect(html).toContain('data-lines="1"');
  });
  it('puts an email’s subject and first words on the second line of a two-line row', () => {
    const html = renderToStaticMarkup(<ObjectRow thing={mail} lines={2} onOpen={noop} />);
    expect(html).toContain('data-lines="2"');
    expect(html).toMatch(/ui-mail-subject" data-unread="true">P2 build dates<\/span> · Can you confirm/);
    expect(html).toContain('aria-label="Unread"');
  });
  it('marks what Mobius changed in every form', () => {
    expect(renderToStaticMarkup(<ObjectRow thing={file} onOpen={noop} />)).toContain('data-proposed="true"');
    const card = renderToStaticMarkup(<ObjectCard thing={file} onOpen={noop} />);
    expect(card).toContain('data-by-mobius="true"');
    expect(card).toContain('changed by Mobius');
    expect(card).toContain('<dt>Changed</dt><dd>2 cells in Sheet 1</dd>');
    expect(renderToStaticMarkup(<ObjectChip thing={file} />)).toContain('data-by-mobius="true"');
  });
  it('names the card by its kind and title, and opens it', () => {
    const card = renderToStaticMarkup(<ObjectCard thing={task} onOpen={noop} />);
    expect(card).toContain('aria-label="Task: Pay the Veltro deposit"');
    expect(card).toContain('aria-label="Open Pay the Veltro deposit"');
  });
});

describe('the two-axis pad', () => {
  it('reads out both axes and marks where it started', () => {
    const html = renderToStaticMarkup(<XYPad label="Feel" x={{ name: 'Bright', ends: ['Dark', 'Bright'] }} y={{ name: 'Busy', ends: ['Calm', 'Busy'] }} value={{ x: 0.71, y: 0.73 }} start={{ x: 0.38, y: 0.42 }} onChange={noop} />);
    expect(html).toContain('aria-valuetext="Bright 71%, Busy 73%"');
    expect(html).toMatch(/class="ui-pad-start" style="left:38%;top:5[78][\d.]*%"/);
    expect(html).toContain('class="ui-pad-point" style="left:71%;top:27');
    expect(html).toContain('<small>Busy</small><b>73%</b>');
  });
});

describe('popovers', () => {
  it('exports the popover and the choice menu', async () => {
    const mod = await import('./Popover');
    expect(typeof mod.Popover).toBe('function');
    expect(typeof mod.ChoiceMenu).toBe('function');
  });
});

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkingPill } from './WorkingPill';

const noop = () => undefined;

describe('the working pill', () => {
  it('says what Mobius is doing and how far through its plan, with Stop', () => {
    const html = renderToStaticMarkup(<WorkingPill activity={{ label: 'Reading a sheet', app: 'sheets', step: { done: 1, total: 4 }, needsYou: false }} onOpen={noop} onStop={noop} />);
    expect(html).toContain('Reading a sheet');
    expect(html).toContain('2 of 4');
    expect(html).toContain('aria-label="Stop Mobius"');
  });

  it('says only that Mobius needs you while it waits, without Stop or a step', () => {
    const html = renderToStaticMarkup(<WorkingPill activity={{ label: 'Waiting for your answer', app: null, step: { done: 1, total: 4 }, needsYou: true }} onOpen={noop} onStop={noop} />);
    expect(html).toContain('Mobius needs you');
    expect(html).toContain('data-needs-you');
    expect(html).not.toContain('Stop Mobius');
    expect(html).not.toContain('2 of 4');
  });

  it('leaves the step out for a one-step plan', () => {
    const html = renderToStaticMarkup(<WorkingPill activity={{ label: 'Thinking', app: null, step: { done: 0, total: 1 }, needsYou: false }} onOpen={noop} onStop={noop} />);
    expect(html).not.toContain('working-pill-step');
  });

  it('offers Pause while Mobius works, when it can be paused', () => {
    const html = renderToStaticMarkup(<WorkingPill activity={{ label: 'Changing a sheet', app: 'sheets', needsYou: false }} onOpen={noop} onStop={noop} onPause={async () => null} />);
    expect(html).toContain('aria-label="Pause Mobius"');
    expect(html).not.toContain('Resume');
  });

  it('says Paused, where it stopped, and offers Resume and Stop once paused', () => {
    const html = renderToStaticMarkup(<WorkingPill activity={{ label: 'Paused', app: null, needsYou: false, paused: { step: 2, of: 5 } }} onOpen={noop} onStop={noop} onPause={async () => null} onResume={async () => null} />);
    expect(html).toContain('data-paused');
    expect(html).toContain('step 2 of 5');
    expect(html).toContain('>Resume<');
    expect(html).toContain('Stop Mobius');
    expect(html).not.toContain('Pause Mobius');
  });
});

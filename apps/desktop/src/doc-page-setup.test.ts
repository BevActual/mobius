import { describe, expect, it } from 'vitest';
import { defaultSetup, pageRule, paperFor, readSetup, textWidth } from './doc-page-setup';

describe('page setup', () => {
  it('starts on Letter where it is the custom and A4 elsewhere', () => {
    expect(paperFor('en-US')).toBe('letter');
    expect(paperFor('en-CA')).toBe('letter');
    expect(paperFor('en-GB')).toBe('a4');
    expect(paperFor('en-AU')).toBe('a4');
    expect(paperFor('de-DE')).toBe('a4');
    expect(defaultSetup('fr-FR')).toEqual({ paper: 'a4', orientation: 'portrait', margins: 'normal' });
  });

  it('makes the text as wide as the paper less its margins', () => {
    expect(textWidth({ paper: 'letter', orientation: 'portrait', margins: 'normal' })).toBe(624);
    expect(textWidth({ paper: 'letter', orientation: 'portrait', margins: 'narrow' })).toBe(720);
    expect(textWidth({ paper: 'letter', orientation: 'landscape', margins: 'normal' })).toBe(864);
    expect(textWidth({ paper: 'a4', orientation: 'portrait', margins: 'wide' })).toBe(410);
  });

  it('prints on the same paper and margins', () => {
    expect(pageRule({ paper: 'a4', orientation: 'landscape', margins: 'narrow' })).toBe('@page { size: A4 landscape; margin: 0.5in 0.5in; }');
    expect(pageRule({ paper: 'letter', orientation: 'portrait', margins: 'wide' })).toBe('@page { size: letter portrait; margin: 1in 2in; }');
  });

  it('reads back what was kept, and the default for anything else', () => {
    const fallback = defaultSetup('en-US');
    expect(readSetup('{"paper":"a4","orientation":"landscape","margins":"wide"}', fallback)).toEqual({ paper: 'a4', orientation: 'landscape', margins: 'wide' });
    expect(readSetup('{"paper":"legal","margins":"huge"}', fallback)).toEqual(fallback);
    expect(readSetup('not json', fallback)).toEqual(fallback);
    expect(readSetup(null, fallback)).toEqual(fallback);
  });
});

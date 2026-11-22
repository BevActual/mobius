import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SampleSlot, sampleName } from './StudioSample';
import { importSample, toBase64 } from './studio-engine';

const noop = () => {};

describe('the sample slot', () => {
  it('asks for a file when empty, and names the sample with Replace and Remove once it has one', () => {
    const empty = renderToStaticMarkup(<SampleSlot label="Sample" songPath="Songs/a.song" sample={undefined} onSample={noop} />);
    expect(empty).toContain('Drop a sound file here');
    expect(empty).toContain('Choose…');
    expect(empty).not.toContain('Remove');
    const held = renderToStaticMarkup(<SampleSlot label="Sample" songPath="Songs/a.song" sample={{ file: 'Samples/kick 01.wav' }} onSample={noop} />);
    expect(held).toContain('kick 01');
    expect(held).toContain('Replace…');
    expect(held).toContain('Remove');
  });
  it('names a sample by its file', () => expect(sampleName('Samples/Recorded/take 2.wav')).toBe('take 2'));
});

describe('importing a sample', () => {
  it('turns bytes into base64 in chunks', () => {
    const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
    expect(atob(toBase64(bytes)).length).toBe(70_000);
    expect(toBase64(new Uint8Array([77, 111, 98]))).toBe('TW9i');
  });
  it('says so without the desktop app', async () => {
    expect(await importSample('Songs/a.song', new File(['x'], 'a.wav'))).toEqual({ problem: 'Adding samples needs a newer Mobius desktop app.' });
  });
});

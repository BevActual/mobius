import { describe, expect, it } from 'vitest';
import { exportFormat, exportName, exportSize, fitRect } from './video-export';

describe('exportFormat', () => {
  it('prefers MP4, falls back to WebM, and is null when nothing records', () => {
    expect(exportFormat(() => true)?.ext).toBe('mp4');
    expect(exportFormat((m) => m.startsWith('video/webm'))?.mime).toBe('video/webm;codecs=vp9,opus');
    expect(exportFormat((m) => m === 'video/webm')?.ext).toBe('webm');
    expect(exportFormat((m) => m === 'video/mp4' || m === 'video/webm')?.ext).toBe('webm');
    expect(exportFormat((m) => m === 'video/mp4')?.ext).toBe('mp4');
    expect(exportFormat(() => false)).toBeNull();
    expect(exportFormat(() => { throw new Error('no'); })).toBeNull();
  });
});

describe('exportSize', () => {
  it('keeps the first clip’s shape, no bigger than 1080p, in even numbers', () => {
    expect(exportSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(exportSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(exportSize(1080, 1920)).toEqual({ width: 608, height: 1080 });
    expect(exportSize(161, 91)).toEqual({ width: 162, height: 92 });
    expect(exportSize(0, 0)).toEqual({ width: 1280, height: 720 });
  });
});

describe('fitRect', () => {
  it('centres the picture as large as fits', () => {
    expect(fitRect(640, 480, 1280, 720)).toEqual({ x: 160, y: 0, w: 960, h: 720 });
    expect(fitRect(1920, 1080, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(fitRect(0, 0, 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });
});

describe('exportName', () => {
  it('is the project’s name with the format’s ending, without characters a file name cannot hold', () => {
    expect(exportName('Kestrel P2 launch', { mime: 'video/mp4', ext: 'mp4' })).toBe('Kestrel P2 launch.mp4');
    expect(exportName('a/b:c', { mime: 'video/webm', ext: 'webm' })).toBe('a b c.webm');
    expect(exportName('  ', { mime: 'video/webm', ext: 'webm' })).toBe('Film.webm');
  });
});

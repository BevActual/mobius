import type { Fit, Hardware } from '@mobius/shared';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${units[unit]}`;
}

export function compactCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '';
  if (count < 1000) return String(Math.round(count));
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function paramsText(billions: number): string {
  if (!Number.isFinite(billions) || billions < 0) return '';
  if (billions < 0.05) return '<0.1B';
  return billions < 10 ? `${billions.toFixed(1)}B` : `${Math.round(billions)}B`;
}

export function percent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((done / total) * 100)));
}

export function fitText(fit: Fit): { label: string; tone: 'good' | 'warn' | 'bad' } {
  switch (fit) {
    case 'gpu': return { label: 'Fits on your GPU', tone: 'good' };
    case 'split': return { label: 'Slower: part runs on the CPU', tone: 'warn' };
    case 'cpu': return { label: 'CPU only: slow', tone: 'warn' };
    default: return { label: 'Too big for this computer', tone: 'bad' };
  }
}

export function hardwareSummary(hardware: Hardware): string {
  const memory = `${formatBytes(hardware.ram_total)} memory (${formatBytes(hardware.ram_free)} free).`;
  if (!hardware.gpu_name || hardware.vram_total <= 0) return `No dedicated graphics card was found, so models would run on the processor. ${memory}`;
  return `${hardware.gpu_name}, ${formatBytes(hardware.vram_total)} graphics memory (${formatBytes(hardware.vram_free)} free). ${memory}`;
}

export function modelTitle(model: { file: string; repo: string | null }): { name: string; from: string | null } {
  const base = model.file.split('/').pop() ?? model.file;
  return { name: base.replace(/\.gguf$/i, ''), from: model.repo };
}

import type { DeviceVoiceStatus } from '@mobius/shared';

/** One line on whether the speech server on this computer answers at the saved address, and how to start one if not. */
export function localStatusText(job: 'listen' | 'speak', ready: boolean, url: string): string {
  if (ready) return `Ready: the speech server at ${url} answers.`;
  const which = job === 'listen'
    ? 'a speech-to-text server such as faster-whisper (Speaches)'
    : 'a text-to-speech server such as Kokoro-FastAPI';
  return `Not running at ${url}. Start ${which} on this computer at that address, then check again.`;
}

/** Megabytes, rounded, for a download's size. */
export const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;

/** What listening on this computer is doing, in one line. */
export function deviceText(status: DeviceVoiceStatus): string {
  if (!status.available) return 'Not available on this computer yet.';
  switch (status.state) {
    case 'ready': return 'Ready. What you say is written down on this computer and never leaves it.';
    case 'downloading': return status.total ? `Downloading: ${megabytes(status.done ?? 0)} of ${megabytes(status.total)}.` : 'Downloading…';
    case 'failed': return status.message ?? 'Setting up failed.';
    default: return `Whisper is downloaded once (${megabytes(status.bytes)}) and runs on this computer. What you say never leaves it.`;
  }
}

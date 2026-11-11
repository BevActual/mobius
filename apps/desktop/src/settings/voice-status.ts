/** One line on whether the speech server on this computer answers at the saved address, and how to start one if not. */
export function localStatusText(job: 'listen' | 'speak', ready: boolean, url: string): string {
  if (ready) return `Ready: the speech server at ${url} answers.`;
  const which = job === 'listen'
    ? 'a speech-to-text server such as faster-whisper (Speaches)'
    : 'a text-to-speech server such as Kokoro-FastAPI';
  return `Not running at ${url}. Start ${which} on this computer at that address, then check again.`;
}

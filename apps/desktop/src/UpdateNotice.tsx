import { useUpdates } from './useUpdates';

/** A small notice in the toolbar once an update is downloaded: Mobius never interrupts with a dialog for it. */
export function UpdateNotice() {
  const { info, restart } = useUpdates();
  if (info.state !== 'ready') return null;
  return (
    <button type="button" className="update-notice" title={info.status} onClick={() => void restart()}>
      <span className="update-dot" aria-hidden="true" />
      Update available · Restart to install
    </button>
  );
}

import type { DownloadEntry } from '@mobius/shared';
import { formatBytes, percent } from './settings/models-format';

const TEXT = { done: 'Done', failed: 'Failed', cancelled: 'Cancelled' } as const;

/** What has been downloaded, in the browser's sidebar because a popover would be hidden behind the page. */
export function DownloadsList({ entries }: { entries: DownloadEntry[] }) {
  if (entries.length === 0) return null;
  const busy = entries.some((e) => e.state === 'downloading');
  return (
    <section className="downloads" aria-label="Downloads">
      <div className="side-head">
        <span className="side-title">Downloads</span>
        <button type="button" className="btn" disabled={entries.every((e) => e.state === 'downloading')} onClick={() => window.mobius.downloads.clear()}>Clear</button>
      </div>
      <ul className="dl-list" role="list">
        {entries.map((entry) => (
          <li key={entry.id} className="dl-item" data-state={entry.state}>
            <span className="dl-name" title={entry.name}>{entry.name}</span>
            {entry.state === 'downloading' ? (
              <>
                {entry.total > 0 ? <progress aria-label={`Progress of ${entry.name}`} max={100} value={percent(entry.received, entry.total)} /> : <span className="dl-sub">{formatBytes(entry.received)}</span>}
                <button type="button" className="btn" aria-label={`Cancel ${entry.name}`} onClick={() => window.mobius.downloads.cancel(entry.id)}>Cancel</button>
              </>
            ) : (
              <>
                <span className="dl-sub">{TEXT[entry.state]}{entry.state === 'done' && entry.risky ? ' · can run programs' : ''}</span>
                {entry.state === 'done' && (
                  <span className="dl-actions">
                    {!entry.risky && <button type="button" className="btn" aria-label={`Open ${entry.name}`} onClick={() => window.mobius.downloads.open(entry.id)}>Open</button>}
                    <button type="button" className="btn" aria-label={`Show ${entry.name} in folder`} onClick={() => window.mobius.downloads.show(entry.id)}>Show in folder</button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {busy && <span className="sr-only" role="status">Downloading</span>}
    </section>
  );
}

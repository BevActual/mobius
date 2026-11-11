import type { PreferencesSettings } from '@mobius/shared';
import { settingPath } from './manifest';
import { Row } from './primitives';
import { Toggle } from './sections';
import { useUpdates } from '../useUpdates';

/** Settings › About › Software Update: the version running, what the updater is doing, Check for Updates, and the switch. */
export function SoftwareUpdate({ highlight, preferences, onPreferences }: { highlight: string | null; preferences: PreferencesSettings; onPreferences: (change: Partial<PreferencesSettings>) => Promise<void> }) {
  const { info, check, restart } = useUpdates();
  const busy = info.state === 'checking' || info.state === 'downloading';
  return (
    <>
      <Row path={settingPath('about', 'app', 'software-update')} title="Software Update" description={info.current ? `Mobius ${info.current}` : 'Mobius'} highlight={highlight === 'software-update'}>
        <div className="inline-form">
          <span className="srow-text" role="status" data-update-state={info.state}>{info.status}</span>
          {info.state === 'ready'
            ? <button type="button" className="btn primary" onClick={() => void restart()}>Restart to Install</button>
            : <button type="button" className="btn" disabled={info.state === 'off' || busy} onClick={() => void check()}>Check for Updates</button>}
        </div>
      </Row>
      <Row path={settingPath('about', 'app', 'auto-update')} title="Automatically install updates" description="Mobius always checks and downloads by itself. With this on, a downloaded update is also installed the next time Mobius quits." highlight={highlight === 'auto-update'}>
        <Toggle label="Automatically install updates" checked={preferences.autoUpdate} onChange={(autoUpdate) => void onPreferences({ autoUpdate })} />
      </Row>
    </>
  );
}

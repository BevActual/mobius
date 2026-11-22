import { useCallback, useEffect, useState } from 'react';
import { isNotesFailure, type CalendarAccount, type ChatAccount, type DriveAccount, type MailAccount, type ProviderInfo } from '@mobius/shared';
import { Menu, type MenuEntry } from '../ui';
import { ADD_LABEL, ADJUST_IN, connectionState, gatherConnections, type Connection, type ConnectionSources } from './connections';
import type { SectionId } from './manifest';
import { siteHue } from '../browser-spaces';

const ok = <T,>(r: T[] | { ok: false } | null | undefined): T[] => (Array.isArray(r) ? r : []);

/** Every account, read from each app's own store, and read again when one of them changes. */
function useConnections(): { sources: ConnectionSources; loaded: boolean; reload: () => void } {
  const m = window.mobius;
  const [sources, setSources] = useState<ConnectionSources>({ mail: [], calendar: [], drives: [], chat: [], providers: [] });
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => {
    void Promise.all([
      m.mail?.accounts().catch(() => null),
      m.calendar?.accounts().catch(() => null),
      m.drives?.list().catch(() => null),
      m.messages?.accounts().catch(() => null),
      m.providers?.list().catch(() => null),
    ]).then(([mail, calendar, drives, chat, providers]) => {
      setSources({
        mail: mail && !isNotesFailure(mail) ? (mail as MailAccount[]) : [],
        calendar: calendar && !isNotesFailure(calendar) ? (calendar as CalendarAccount[]) : [],
        drives: ok(drives as DriveAccount[] | null),
        chat: chat && !isNotesFailure(chat) ? (chat as ChatAccount[]) : [],
        providers: ok(providers as ProviderInfo[] | null),
      });
      setLoaded(true);
    });
  }, [m]);
  useEffect(() => {
    load();
    const offs = [m.mail?.onChanged(load), m.calendar?.onChanged(load), m.messages?.onChanged(load)];
    return () => offs.forEach((off) => off?.());
  }, [m, load]);
  return { sources, loaded, reload: load };
}

async function disconnect(c: Connection): Promise<void> {
  const m = window.mobius;
  if (c.kind === 'mail') await m.mail?.removeAccount(c.id);
  else if (c.kind === 'calendar') await m.calendar?.removeAccount(c.id);
  else if (c.kind === 'drive') await m.drives?.remove(c.id);
  else if (c.kind === 'chat') await m.messages?.removeAccount?.(c.id);
  else await m.providers?.removeKey(c.id);
}

function MoreGlyph() {
  return <svg viewBox="0 0 20 20" aria-hidden="true" className="conn-more-glyph"><circle cx="5" cy="10" r="1.3" /><circle cx="10" cy="10" r="1.3" /><circle cx="15" cy="10" r="1.3" /></svg>;
}

/**
 * Settings › Connections: "Add a connection…" at the top, every account under its kind, each with the service's mark,
 * the account, its state in words (a red dot and one sentence when it needs you) and ⋯ (Adjust, Sign in again,
 * Disconnect, asked once more). At the foot, more ways to connect, in Store.
 */
export function ConnectionsList({ onGo, onOpenApp }: { onGo: (section: SectionId, subpage?: string) => void; onOpenApp?: (id: 'skills' | 'files') => void }) {
  const { sources, loaded, reload } = useConnections();
  const [confirm, setConfirm] = useState<string | null>(null);
  const groups = gatherConnections(sources);
  const adjust = (c: Connection) => { if (c.adjust === 'files') onOpenApp?.('files'); else onGo(c.adjust.section, c.adjust.subpage); };
  const add: MenuEntry[] = [
    { label: 'Mail account…', run: () => onGo('mail') },
    { label: 'Calendar…', run: () => onGo('calendar') },
    { label: 'Drive…', run: () => onOpenApp?.('files'), disabled: !onOpenApp },
    { label: 'Chat account…', run: () => onGo('messages') },
    { label: 'Model gateway…', run: () => onGo('providers') },
  ];
  const addKind: Record<string, () => void> = { mail: () => onGo('mail'), drives: () => onOpenApp?.('files'), chat: () => onGo('messages'), models: () => onGo('providers') };
  return (
    <div className="conn" data-setting="connections.accounts.connections">
      <div className="conn-top">
        <Menu label="Add a connection" entries={add} trigger={<button type="button" className="btn">Add a connection…</button>} />
      </div>
      {groups.map((g) => (
        <section key={g.id} className="conn-group" aria-label={g.label}>
          <h4 className="conn-group-title">{g.label}</h4>
          <ul className="conn-list" aria-label={g.label}>
            {g.items.length === 0 && loaded && (
              <li className="conn-row conn-empty">
                <button type="button" className="conn-add" onClick={() => addKind[g.id]?.()} disabled={g.id === 'drives' && !onOpenApp}>{ADD_LABEL[g.id]}</button>
              </li>
            )}
            {g.items.map((c) => (
              <li key={c.key} className="conn-row" data-problem={c.problem ? 'true' : undefined}>
                <span className="conn-mark" data-hue={siteHue(c.service)} aria-hidden="true">{c.service.slice(0, 1)}</span>
                <span className="conn-main">
                  <span className="conn-account">{c.account}</span>
                  <span className="conn-service">{c.detail ?? c.service}</span>
                </span>
                {confirm === c.key ? (
                  <span className="conn-confirm">
                    <button type="button" className="btn danger" onClick={() => { setConfirm(null); void disconnect(c).then(reload); }}>Disconnect</button>
                    <button type="button" className="btn" autoFocus onClick={() => setConfirm(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    <span className={c.problem ? 'conn-state field-error' : 'conn-state'} {...(c.problem ? { role: 'alert' } : {})}>
                      {c.problem && <span className="conn-dot" aria-hidden="true" />}{connectionState(c)}
                    </span>
                    <Menu label={`${c.account} actions`} align="end" entries={[
                      { label: `Adjust in ${ADJUST_IN[c.kind]}`, run: () => adjust(c) },
                      ...(c.problem ? [{ label: 'Sign in again', run: () => adjust(c) }] : []),
                      { label: 'Disconnect…', run: () => setConfirm(c.key), danger: true, separated: true },
                    ]} trigger={<button type="button" className="strip-btn conn-more" aria-label={`More for ${c.account}`} title="More"><MoreGlyph /></button>} />
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="conn-foot">
        <button type="button" className="conn-find" disabled={!onOpenApp} onClick={() => onOpenApp?.('skills')}>Find more in Abilities <span aria-hidden="true">→</span></button>
      </p>
    </div>
  );
}

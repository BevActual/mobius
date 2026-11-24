import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isNotesFailure, type AccountInfo, type AccountStatus, type CalendarAccount, type ChatAccount, type ConnectorStatus, type ContactAccount, type DriveAccount, type GoogleDriveStatus, type IdentityApp, type MailAccount, type ProviderInfo } from '@mobius/shared';
import { APP_SECTION, NO_SOURCES, SIGN_IN_APPS, accountLine, appsFor, accountName, cardOf, gatherAccounts, needsSignIn, type Account, type AccountApp, type AccountSources, type Part } from './connections';
import type { SectionId } from './manifest';
import { Toggle } from './sections';
import { siteHue } from '../browser-spaces';
import './accounts.css';

const list = <T,>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : []);
const listed = <T,>(r: unknown): T[] => (r && !isNotesFailure(r as never) ? list<T>(r) : []);

/** Which card a list is: the accounts, the model plans and keys, or the connectors. Each reads only its own stores. */
export type AccountsCard = 'accounts' | 'plans' | 'connectors';

/** The accounts a card shows, read from each app's own store, and read again when one of them changes. */
function useAccounts(card: AccountsCard): { sources: AccountSources; loaded: boolean; reload: () => void } {
  const m = window.mobius;
  const [sources, setSources] = useState<AccountSources>(NO_SOURCES);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => {
    const mine = (on: AccountsCard, read: () => Promise<unknown> | undefined) => (card === on ? (read() ?? Promise.resolve(null)).catch(() => null) : Promise.resolve(null));
    const plans = () => m.providers?.accounts().then((all) => Promise.all(all.map((info) => m.providers!.accountStatus(info.id).then((status) => ({ info, status })).catch(() => null))));
    void Promise.all([
      mine('accounts', () => m.mail?.accounts()),
      mine('accounts', () => m.calendar?.accounts()),
      mine('accounts', () => m.contacts?.accounts()),
      mine('accounts', () => m.drives?.list()),
      mine('accounts', () => m.googleDrive?.status()),
      mine('accounts', () => m.messages?.accounts()),
      mine('plans', plans),
      mine('plans', () => m.providers?.list()),
      mine('connectors', () => m.extensions?.connectors()),
      mine('accounts', () => m.accounts?.list()),
    ]).then(([mail, calendar, contacts, drives, googleDrive, chat, planned, providers, connectors, identities]) => {
      setSources({
        mail: listed<MailAccount>(mail),
        calendar: listed<CalendarAccount>(calendar),
        contacts: listed<ContactAccount>(contacts),
        drives: list<DriveAccount>(drives),
        googleDrive: (googleDrive as GoogleDriveStatus | null) ?? null,
        chat: listed<ChatAccount>(chat),
        plans: list<{ info: AccountInfo; status: AccountStatus } | null>(planned).filter((p): p is { info: AccountInfo; status: AccountStatus } => p !== null),
        providers: list<ProviderInfo>(providers),
        connectors: (connectors as ConnectorStatus | null) ?? null,
        identities: list(identities),
      });
      setLoaded(true);
    });
  }, [m, card]);
  useEffect(() => {
    load();
    const offs = card === 'accounts'
      ? [m.mail?.onChanged(load), m.calendar?.onChanged(load), m.messages?.onChanged(load), m.contacts?.onChanged(load), m.drives?.onChanged(load), m.googleDrive?.onChanged(load), m.accounts?.onSignIn(load)]
      : card === 'plans' ? [m.providers?.onChanged(load)] : [];
    return () => offs.forEach((off) => off?.());
  }, [m, load, card]);
  return { sources, loaded, reload: load };
}

/** The host's name for an account's provider, for remembering and forgetting it. */
const hostProvider = (provider: string): string => (provider === 'Google' ? 'google' : provider === 'Microsoft' ? 'microsoft' : provider);
const signsInHere = (provider: string): provider is 'Google' | 'Microsoft' => provider === 'Google' || provider === 'Microsoft';

/** Removes one app's part the way that app removes it. Google Drive's sign-in is only forgotten when Calendar shares it. */
async function removePart(p: Part): Promise<void> {
  const m = window.mobius;
  if (p.kind === 'mail') await m.mail?.removeAccount(p.id);
  else if (p.kind === 'calendar') await m.calendar?.removeAccount(p.id);
  else if (p.kind === 'contacts') await m.contacts?.removeAccount(p.id);
  else if (p.kind === 'drive') await m.drives?.remove(p.id);
  else if (p.kind === 'googleDrive') await m.googleDrive?.signOut();
  else if (p.kind === 'chat') await m.messages?.removeAccount?.(p.id);
  else if (p.kind === 'plan') await m.providers?.signOut(p.id);
  else if (p.kind === 'key') await m.providers?.removeKey(p.id);
  else await m.extensions?.removeConnector?.(p.id);
}

/** One Google or Microsoft sign-in for `apps`: opens its page, answers why not or null. */
async function signIn(provider: 'Google' | 'Microsoft', apps: IdentityApp[]): Promise<string | null> {
  const r = await window.mobius.accounts?.signIn({ provider: hostProvider(provider) as 'google' | 'microsoft', apps }).catch(() => null);
  if (!r) return 'Signing in is not available here.';
  if (isNotesFailure(r)) return r.message;
  void window.mobius.browser.open(r.url);
  return null;
}

function Mark({ provider, size }: { provider: string; size?: 'large' }) {
  return <span className={size ? 'conn-mark acct-mark-large' : 'conn-mark'} data-hue={siteHue(provider)} aria-hidden="true">{provider.slice(0, 1)}</span>;
}

function Chevron() {
  return <svg className="acct-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5l5 5-5 5" /></svg>;
}

type AddTo = SectionId | 'google' | 'microsoft' | 'files' | 'other';
/** Add Account…'s rows: providers, as macOS lists them, then Other Account… for the kinds of account. */
const ADD: Array<{ name: string; go: AddTo }> = [
  { name: 'Google', go: 'google' },
  { name: 'Microsoft', go: 'microsoft' },
  { name: 'iCloud', go: 'mail' },
  { name: 'Fastmail', go: 'mail' },
  { name: 'Slack', go: 'messages' },
  { name: 'Dropbox', go: 'files' },
];
const OTHER: Array<{ name: string; go: AddTo }> = [
  { name: 'Mail account', go: 'mail' },
  { name: 'CalDAV calendar', go: 'calendar' },
  { name: 'Calendar subscription', go: 'calendar' },
  { name: 'CardDAV contacts', go: 'contacts' },
  { name: 'WebDAV or S3 drive', go: 'files' },
  { name: 'Matrix', go: 'messages' },
  { name: 'Telegram', go: 'messages' },
];

/** Add Account…: one row per provider, then Other Account…. Google and Microsoft sign in here, for Calendar and Files at once. */
function AddSheet({ onClose, onGo, onOpenApp, onAdded }: { onClose: () => void; onGo: (section: SectionId) => void; onOpenApp: ((id: 'skills' | 'files') => void) | undefined; onAdded: (key: string) => void }) {
  const [waiting, setWaiting] = useState<'Google' | 'Microsoft' | null>(null);
  const [other, setOther] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const added = useRef(onAdded);
  added.current = onAdded;
  useEffect(() => window.mobius.accounts?.onSignIn((done) => {
    setWaiting(null);
    if (!done.ok) { setProblem(done.message); return; }
    added.current(`${done.account.provider}:${done.account.email.toLowerCase()}`);
  }), []);
  const choose = async (go: AddTo) => {
    setProblem(null);
    if (go === 'other') setOther(true);
    else if (go === 'google' || go === 'microsoft') {
      const provider = go === 'google' ? 'Google' : 'Microsoft';
      const failed = await signIn(provider, ['calendar', 'files']);
      if (failed) setProblem(failed); else setWaiting(provider);
    } else if (go === 'files') { onClose(); onOpenApp?.('files'); }
    else { onClose(); onGo(go); }
  };
  const cancel = () => { if (waiting) void window.mobius.accounts?.cancel(); onClose(); };
  const rows = other ? OTHER : [...ADD, { name: 'Other Account…', go: 'other' as const }];
  return createPortal(
    <div className="cal-modal-layer">
      <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
        <div className="cal-editor acct-sheet" role="dialog" aria-modal="true" aria-label="Add Account" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (other) setOther(false); else cancel(); } }}>
          <h2 className="cal-editor-heading">{other ? 'Other Account' : 'Add Account'}</h2>
          {waiting ? (
            <p className="cal-editor-note">Finish signing in on {waiting}’s page. Mobius turns the account on for Calendar and Files when you’re done.</p>
          ) : (
            <ul className="conn-list" aria-label={other ? 'Kinds of account' : 'Providers'}>
              {rows.map((a, i) => (
                <li key={a.name} className="conn-row acct-row">
                  <button type="button" className="acct-row-button" autoFocus={i === 0} disabled={a.go === 'files' && !onOpenApp} onClick={() => void choose(a.go)}>
                    {a.go === 'other' ? <span className="conn-mark acct-plus" aria-hidden="true">…</span> : <Mark provider={a.name} />}
                    <span className="conn-account">{a.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {problem && <p className="tasks-message" role="alert">{problem}</p>}
          <div className="cal-editor-actions">
            {other && !waiting && <button type="button" className="btn" onClick={() => setOther(false)}>Back</button>}
            <span className="spacer" />
            <button type="button" className="btn" onClick={cancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Remove Account…, asked once more in a sheet that says what goes and what stays. */
function RemoveSheet({ account, onCancel, onRemove }: { account: Account; onCancel: () => void; onRemove: () => void }) {
  return createPortal(
    <div className="cal-modal-layer">
      <div className="cal-editor-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
        <div className="cal-editor" role="alertdialog" aria-modal="true" aria-label={`Remove ${account.address}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
          <h2 className="cal-editor-heading">Remove {account.address}?</h2>
          <p className="cal-editor-note">
            {account.apps.length ? `Mobius stops using it for ${account.apps.join(', ')}. ` : ''}Its mail, calendars and files stay with {account.provider}.
          </p>
          <div className="cal-editor-actions">
            <span className="spacer" />
            <button type="button" className="btn" autoFocus onClick={onCancel}>Cancel</button>
            <button type="button" className="btn danger" onClick={onRemove}>Remove</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** An account's own page: what it is, the apps it is on for, Sign in again when it needs you, and Remove Account…. */
function AccountPage({ account, onGo, onOpenApp, onBack, reload }: { account: Account; onGo: (section: SectionId) => void; onOpenApp: ((id: 'skills' | 'files') => void) | undefined; onBack: () => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  useEffect(() => window.mobius.accounts?.onSignIn((done) => {
    setNote(done.ok ? (done.account.off.length ? done.account.off.map((o) => o.why).join(' ') : null) : done.message);
    setBusy(false);
  }), []);
  /** Where an app's part is added or mended when it can't be done here. */
  const elsewhere = (app: AccountApp) => { if (APP_SECTION[app] === 'connections') onOpenApp?.('files'); else onGo(APP_SECTION[app]); };
  const switchApp = async (app: AccountApp, on: boolean) => {
    setNote(null);
    if (!on) {
      setBusy(true);
      for (const p of account.parts.filter((x) => x.app === app)) await removePart(p);
      // Turning the last app off keeps the account listed, as Internet Accounts does.
      if (app !== 'Models' && app !== 'Connectors') await window.mobius.accounts?.remember({ provider: hostProvider(account.provider), email: account.address });
      setBusy(false);
      reload();
      return;
    }
    const here = SIGN_IN_APPS[app];
    if (signsInHere(account.provider) && here) {
      setBusy(true);
      const failed = await signIn(account.provider, [here]);
      if (failed) { setNote(failed); setBusy(false); } else setNote(`Finish signing in on ${account.provider}’s page.`);
      return;
    }
    elsewhere(app);
  };
  const mend = async () => {
    const broken = account.parts.filter((p) => p.problem);
    const apps = [...new Set(broken.map((p) => SIGN_IN_APPS[p.app]).filter((a): a is IdentityApp => !!a))];
    if (signsInHere(account.provider) && apps.length === broken.length && apps.length) {
      setBusy(true);
      const failed = await signIn(account.provider, apps);
      if (failed) { setNote(failed); setBusy(false); } else setNote(`Finish signing in on ${account.provider}’s page.`);
      return;
    }
    const connector = broken.find((p) => p.kind === 'connector');
    if (connector) {
      const r = await window.mobius.extensions?.connectorSignIn?.(connector.id);
      if (r?.ok) void window.mobius.browser.open(r.url); else setNote(r?.error ?? 'Signing in is not available here.');
      return;
    }
    if (broken[0]) elsewhere(broken[0].app);
  };
  const remove = async () => {
    setRemoving(false);
    setBusy(true);
    for (const p of account.parts) await removePart(p);
    await window.mobius.accounts?.forget({ provider: hostProvider(account.provider), email: account.address });
    setBusy(false);
    reload();
    onBack();
  };
  const apps = appsFor(account);
  return (
    <div className="acct-page" data-setting="connections.accounts.account">
      <p className="settings-crumb">Connections › Accounts › {account.address}</p>
      <div className="acct-head">
        <Mark provider={account.provider} size="large" />
        <div className="acct-head-text">
          <h2 className="settings-heading">{account.address}</h2>
          <p className="acct-state">{needsSignIn(account) && <span className="conn-dot" aria-hidden="true" />}{account.provider} · {account.problem ? 'Sign in again' : 'Connected'}</p>
        </div>
      </div>
      {apps.length > 0 && (
        <section className="settings-group" aria-label="Use this account for">
          <h3 className="settings-group-title">Use this account for</h3>
          <ul className="conn-list" aria-label="Apps">
            {apps.map((app) => (
              <li key={app} className="conn-row acct-app">
                <span className="conn-account">{app}</span>
                <span className="acct-switch" aria-disabled={busy || undefined}><Toggle label={app} checked={account.apps.includes(app)} onChange={(on) => { if (!busy) void switchApp(app, on); }} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {account.problem && (
        <section className="settings-group" aria-label="Needs you">
          <ul className="conn-list">
            <li className="conn-row acct-app">
              <span className="conn-account">Sign in again</span>
              <button type="button" className="btn" disabled={busy} onClick={() => void mend()}>Sign In…</button>
            </li>
          </ul>
        </section>
      )}
      {note && <p className="cal-editor-note" role="status">{note}</p>}
      <p className="acct-remove-line"><button type="button" className="acct-remove" disabled={busy} onClick={() => setRemoving(true)}>Remove Account…</button></p>
      {removing && <RemoveSheet account={account} onCancel={() => setRemoving(false)} onRemove={() => void remove()} />}
    </div>
  );
}

/** One row: its mark, its name, a grey line (with a red dot only when it needs a sign-in) and a chevron. */
function AccountRow({ account, onOpen }: { account: Account; onOpen: () => void }) {
  return (
    <li className="conn-row acct-row" data-problem={account.problem ? 'true' : undefined}>
      <button type="button" className="acct-row-button" onClick={onOpen}>
        <Mark provider={cardOf(account) === 'connectors' ? account.address : account.provider} />
        <span className="conn-main">
          <span className="conn-account">{accountName(account)}</span>
          <span className="conn-service">{needsSignIn(account) && <span className="conn-dot" aria-hidden="true" />}{accountLine(account)}</span>
        </span>
        <Chevron />
      </button>
    </li>
  );
}

const EMPTY: Record<AccountsCard, string> = { accounts: 'No accounts yet.', plans: 'No model plans or keys yet.', connectors: 'No connectors yet.' };
const LISTS: Record<AccountsCard, string> = { accounts: 'Accounts', plans: 'Model plans', connectors: 'Connectors' };

/**
 * Settings › Connections › Accounts. Three cards, one per page: Accounts (one row per account, Add Account… last; a row
 * opens the account's own page), Model Plans (a row opens Gateways at that service) and Connectors (a row opens Store).
 */
export function ConnectionsList({ card = 'accounts', onGo, onOpenApp, detail = null, onOpen = () => {} }: { card?: AccountsCard; onGo: (section: SectionId, subpage?: string, row?: string) => void; onOpenApp?: (id: 'skills' | 'files') => void; detail?: string | null; onOpen?: (key: string | null) => void }) {
  const { sources, loaded, reload } = useAccounts(detail ? 'accounts' : card);
  const [adding, setAdding] = useState(false);
  const rows = gatherAccounts(sources).filter((a) => cardOf(a) === (detail ? 'accounts' : card));
  if (detail) {
    const account = rows.find((a) => a.key === detail);
    if (account) return <AccountPage account={account} onGo={onGo} onOpenApp={onOpenApp} onBack={() => onOpen(null)} reload={reload} />;
    return loaded ? <p className="srow-empty">That account isn’t here any more.</p> : null;
  }
  const open = (a: Account) => {
    if (card === 'accounts') onOpen(a.key);
    else if (card === 'plans') onGo('providers', 'keys', `service-${a.parts[0]?.id ?? ''}`);
    else onOpenApp?.('skills');
  };
  return (
    <div className="conn" data-setting={`connections.${card}.${card === 'accounts' ? 'connections' : card}`}>
      <ul className="conn-list" aria-label={LISTS[card]}>
        {loaded && rows.length === 0 && <li className="conn-row conn-empty"><span className="conn-service">{EMPTY[card]}</span></li>}
        {rows.map((a) => <AccountRow key={a.key} account={a} onOpen={() => open(a)} />)}
        {card === 'accounts' && (
          <li className="conn-row acct-row">
            <button type="button" className="acct-row-button" onClick={() => setAdding(true)}>
              <span className="conn-mark acct-plus" aria-hidden="true">+</span>
              <span className="conn-account">Add Account…</span>
            </button>
          </li>
        )}
      </ul>
      {card === 'connectors' && (
        <p className="conn-foot">
          <button type="button" className="conn-find" disabled={!onOpenApp} onClick={() => onOpenApp?.('skills')}>Find more in Store <span aria-hidden="true">→</span></button>
        </p>
      )}
      {adding && <AddSheet onClose={() => setAdding(false)} onGo={(s) => onGo(s)} onOpenApp={onOpenApp} onAdded={(key) => { setAdding(false); reload(); onOpen(key); }} />}
    </div>
  );
}

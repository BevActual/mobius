import type { AccountInfo, AccountStatus, CalendarAccount, ChatAccount, ConnectorStatus, ContactAccount, DriveAccount, GoogleDriveStatus, Identity, MailAccount, ProviderInfo } from '@mobius/shared';
import type { SectionId } from './manifest';

/**
 * Settings › Accounts: one row per account, as macOS's Internet Accounts lists them. A Google account that serves
 * Mail, Calendar and Files is one row, gathered from each app's own store by provider and address; each app still keeps
 * its own part, which is what a switch on the account's page adds or removes.
 */

/** The apps an account can be on for, in the order the grey line names them. */
export const APPS = ['Mail', 'Calendar', 'Contacts', 'Files', 'Messages', 'Models', 'Connectors'] as const;
export type AccountApp = (typeof APPS)[number];

/** One app's part of an account: a mail account, a calendar account, a drive, a plan… */
export interface Part {
  app: AccountApp;
  /** What kind of record it is, so it is removed the way its app removes it. */
  kind: 'mail' | 'calendar' | 'contacts' | 'drive' | 'googleDrive' | 'chat' | 'plan' | 'key' | 'connector';
  id: string;
  /** null when all is well; otherwise a few words on what is wrong. */
  problem: string | null;
}

export interface Account {
  /** provider:address, lower case: stable across reloads, so it can be a page's address. */
  key: string;
  /** As people know it: "Google", "Microsoft", "iCloud", "Slack". */
  provider: string;
  address: string;
  parts: Part[];
  /** The apps it is on for, in APPS order. */
  apps: AccountApp[];
  /** The first part's problem, if any. */
  problem: string | null;
}

export interface AccountSources {
  mail: readonly MailAccount[];
  calendar: readonly CalendarAccount[];
  contacts: readonly ContactAccount[];
  drives: readonly DriveAccount[];
  googleDrive: GoogleDriveStatus | null;
  chat: readonly ChatAccount[];
  plans: readonly { info: AccountInfo; status: AccountStatus }[];
  providers: readonly ProviderInfo[];
  connectors: ConnectorStatus | null;
  /** Accounts signed in to once, kept listed though no app uses them now. */
  identities: readonly Identity[];
}

export const NO_SOURCES: AccountSources = { mail: [], calendar: [], contacts: [], drives: [], googleDrive: null, chat: [], plans: [], providers: [], connectors: null, identities: [] };

const CHAT_NAMES: Record<ChatAccount['service'], string> = { slack: 'Slack', matrix: 'Matrix', teams: 'Microsoft', discord: 'Discord', telegram: 'Telegram' };
const DRIVE_NAMES: Record<DriveAccount['kind'], string> = { webdav: 'WebDAV', s3: 'S3', dropbox: 'Dropbox', onedrive: 'Microsoft', local: 'This computer' };
const PROVIDER_NAMES: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' };

/** A mail service by its address's domain, as people would name it; otherwise "Mail". */
export function mailService(email: string): string {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (/^(gmail|googlemail)\.com$/.test(domain)) return 'Gmail';
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return 'Outlook';
  if (/^(icloud|me|mac)\.com$/.test(domain)) return 'iCloud';
  if (/^(fastmail\.(com|fm)|messagingengine\.com)$/.test(domain)) return 'Fastmail';
  if (/^(proton\.me|protonmail\.com)$/.test(domain)) return 'Proton';
  if (/^yahoo\.[a-z.]+$/.test(domain)) return 'Yahoo';
  return 'Mail';
}

/** The company behind an address, so Gmail and Google Calendar land on one row. */
export function providerOf(email: string, fallback: string): string {
  const service = mailService(email);
  if (service === 'Gmail') return 'Google';
  if (service === 'Outlook') return 'Microsoft';
  return service === 'Mail' ? fallback : service;
}

/** A provider's id, as the host keeps it ("google", "microsoft", "icloud"). */
export const providerId = (provider: string): string => provider.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const connectorProblem = (f: ConnectorStatus['failed'][number]): string => (f.signIn ? 'Sign in again' : 'Didn’t start');

/** Every account, one row each, by provider and then address. */
export function gatherAccounts(s: AccountSources): Account[] {
  const rows = new Map<string, Account>();
  const add = (provider: string, address: string, part: Part | null) => {
    const shown = address.trim() || provider;
    const key = `${providerId(provider)}:${shown.toLowerCase()}`;
    const row = rows.get(key) ?? { key, provider, address: shown, parts: [], apps: [], problem: null };
    if (part) row.parts.push(part);
    rows.set(key, row);
  };
  const again = (problem: string | null | undefined) => (problem ? 'Sign in again' : null);
  for (const a of s.mail) add(providerOf(a.email, 'Mail'), a.email, { app: 'Mail', kind: 'mail', id: a.id, problem: again(a.problem) });
  for (const a of s.calendar) {
    const provider = a.kind === 'google' ? 'Google' : a.kind === 'microsoft' ? 'Microsoft' : a.kind === 'subscription' ? 'Subscription' : providerOf(a.username, 'CalDAV');
    add(provider, a.kind === 'subscription' ? a.name : a.username || a.name, { app: 'Calendar', kind: 'calendar', id: a.id, problem: again(a.problem) });
  }
  for (const a of s.contacts) add(providerOf(a.username, 'CardDAV'), a.username || a.name, { app: 'Contacts', kind: 'contacts', id: a.id, problem: null });
  for (const d of s.drives) if (d.kind !== 'local') add(DRIVE_NAMES[d.kind] ?? 'Drive', d.username || d.name, { app: 'Files', kind: 'drive', id: d.id, problem: null });
  if (s.googleDrive?.signedIn) add('Google', s.googleDrive.account ?? '', { app: 'Files', kind: 'googleDrive', id: 'google-drive', problem: null });
  for (const a of s.chat) add(CHAT_NAMES[a.service] ?? a.service, a.name, { app: 'Messages', kind: 'chat', id: a.id, problem: a.status === 'ready' ? null : 'Sign in again' });
  for (const p of s.plans) if (p.status.signedIn) add(p.info.name, p.status.account || p.info.name, { app: 'Models', kind: 'plan', id: p.info.id, problem: null });
  for (const p of s.providers) if (p.hasKey) add(p.name, p.name, { app: 'Models', kind: 'key', id: p.id, problem: null });
  const c = s.connectors;
  if (c) {
    for (const name of [...c.running, ...(c.waiting ?? [])]) add('Connector', name, { app: 'Connectors', kind: 'connector', id: name, problem: null });
    for (const f of c.failed) add('Connector', f.server, { app: 'Connectors', kind: 'connector', id: f.server, problem: connectorProblem(f) });
  }
  for (const i of s.identities) add(PROVIDER_NAMES[i.provider] ?? i.provider, i.email, null);
  const all = [...rows.values()];
  for (const row of all) {
    row.apps = APPS.filter((app) => row.parts.some((p) => p.app === app));
    row.problem = row.parts.find((p) => p.problem)?.problem ?? null;
  }
  return all.sort((a, b) => a.provider.localeCompare(b.provider) || a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
}

/** The grey line under an account: what it is on for, or what's wrong. */
export const accountLine = (a: Account): string => a.problem ?? (a.apps.length ? a.apps.join(', ') : 'Not on for any app');

/** The apps a provider can serve, for its page's switches, besides those it is on for already. */
export function appsFor(a: Account): AccountApp[] {
  const can: AccountApp[] = a.provider === 'Google' ? ['Mail', 'Calendar', 'Files']
    : a.provider === 'Microsoft' ? ['Calendar', 'Files', 'Messages']
    : ['iCloud', 'Fastmail', 'Yahoo', 'Proton', 'Mail', 'CalDAV', 'CardDAV'].includes(a.provider) ? ['Mail', 'Calendar', 'Contacts']
    : [];
  return APPS.filter((app) => can.includes(app) || a.apps.includes(app));
}

/** The apps one Google or Microsoft sign-in serves, by the host's names. */
export const SIGN_IN_APPS: Partial<Record<AccountApp, 'calendar' | 'files'>> = { Calendar: 'calendar', Files: 'files' };

/** Where an app's own accounts are added and mended, for what can't be done from the account's page. */
export const APP_SECTION: Record<AccountApp, SectionId> = { Mail: 'mail', Calendar: 'calendar', Contacts: 'contacts', Files: 'connections', Messages: 'messages', Models: 'providers', Connectors: 'extensions' };

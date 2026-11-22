import type { CalendarAccount, ChatAccount, DriveAccount, MailAccount, ProviderInfo } from '@mobius/shared';
import type { SectionId } from './manifest';

/**
 * Settings › Connections: every account Mobius signs in to, in one list, as Windows Settings' "Email & accounts" and
 * macOS's "Internet Accounts" do. Each app keeps its own options; this only gathers who is connected and how they are.
 */

export type ConnectionKind = 'mail' | 'calendar' | 'drive' | 'chat' | 'model';
export interface Connection {
  key: string;
  kind: ConnectionKind;
  id: string;
  /** The service, as people know it: "Gmail", "Slack", "OpenAI". */
  service: string;
  /** The account itself: an address, a workspace, a drive's name. */
  account: string;
  /** The grey line under the account; the service's name when not given. */
  detail?: string;
  /** null when all is well; otherwise one sentence on what is wrong. */
  problem: string | null;
  /** Where its options are. */
  adjust: { section: SectionId; subpage?: string } | 'files';
}
export interface ConnectionGroup { id: string; label: string; items: Connection[] }

export interface ConnectionSources {
  mail: readonly MailAccount[];
  calendar: readonly CalendarAccount[];
  drives: readonly DriveAccount[];
  chat: readonly ChatAccount[];
  providers: readonly ProviderInfo[];
}

const CHAT_NAMES: Record<ChatAccount['service'], string> = { slack: 'Slack', matrix: 'Matrix', teams: 'Teams', discord: 'Discord', telegram: 'Telegram' };
const DRIVE_NAMES: Record<DriveAccount['kind'], string> = { webdav: 'WebDAV', s3: 'S3', dropbox: 'Dropbox', onedrive: 'OneDrive', local: 'This computer' };
const CALENDAR_NAMES: Record<CalendarAccount['kind'], string> = { subscription: 'Subscription', caldav: 'CalDAV', google: 'Google', microsoft: 'Microsoft' };

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

const chatProblem = (a: ChatAccount): string | null =>
  a.status === 'ready' ? null : a.status === 'signed-out' ? 'Signed out. Sign in again to read and send.' : (a.message?.trim() || 'Something went wrong with this account.');

/** Every connection, grouped as the page shows them; empty groups are left out. Things on this computer are not accounts. */
export function gatherConnections(s: ConnectionSources): ConnectionGroup[] {
  const groups: ConnectionGroup[] = [
    { id: 'mail', label: 'Mail and calendars', items: [
      ...s.mail.map((a): Connection => ({ key: `mail:${a.id}`, kind: 'mail', id: a.id, service: mailService(a.email), account: a.email, problem: a.problem, adjust: { section: 'mail' } })),
      ...s.calendar.map((a): Connection => ({ key: `calendar:${a.id}`, kind: 'calendar', id: a.id, service: CALENDAR_NAMES[a.kind] ?? 'Calendar', account: a.name || a.username || a.url, problem: a.problem, adjust: { section: 'calendar' } })),
    ] },
    { id: 'drives', label: 'Drives', items: s.drives.filter((d) => d.kind !== 'local').map((d): Connection => ({ key: `drive:${d.id}`, kind: 'drive', id: d.id, service: DRIVE_NAMES[d.kind] ?? 'Drive', account: d.name, problem: null, adjust: 'files' })) },
    { id: 'chat', label: 'Chat', items: s.chat.map((a): Connection => ({ key: `chat:${a.id}`, kind: 'chat', id: a.id, service: CHAT_NAMES[a.service] ?? a.service, account: a.name, problem: chatProblem(a), adjust: { section: 'messages' } })) },
    { id: 'models', label: 'Models', items: s.providers.filter((p) => p.hasKey).map((p): Connection => ({ key: `model:${p.id}`, kind: 'model', id: p.id, service: p.name, account: p.name, detail: p.storage === 'session' ? 'Key kept until Mobius closes' : 'Key in your system’s secret store', problem: null, adjust: { section: 'providers' } })) },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** The words for a connection's state. */
export const connectionState = (c: Connection): string => c.problem ?? 'Connected';

import { describe, expect, it } from 'vitest';
import type { CalendarAccount, ChatAccount, DriveAccount, MailAccount, ProviderInfo } from '@mobius/shared';
import { NO_SOURCES, accountLine, appsFor, gatherAccounts, mailService, providerOf } from './connections';

const mail = (email: string, problem: string | null = null): MailAccount => ({ id: email, name: email, email, lastSyncMs: 0, problem });
const calendar = (id: string, kind: CalendarAccount['kind'], username: string, problem: string | null = null): CalendarAccount => ({ id, kind, name: id, url: '', username, calendars: [], taskLists: [], lastSyncMs: 0, problem });
const drive = (id: string, kind: DriveAccount['kind'], username = ''): DriveAccount => ({ id, kind, name: id, url: '', username });
const chat = (id: string, service: ChatAccount['service'], status: ChatAccount['status'] = 'ready'): ChatAccount => ({ id, service, name: id, status });
const provider = (id: string, hasKey: boolean): ProviderInfo => ({ id, name: id.toUpperCase(), baseUrl: '', note: '', keyUrl: null, needsKey: true, hasKey, active: false, storage: 'keychain' });

describe('accounts', () => {
  it('gathers one row per account across apps, by provider and then address', () => {
    const rows = gatherAccounts({
      ...NO_SOURCES,
      mail: [mail('ana@gmail.com'), mail('me@icloud.com')],
      calendar: [calendar('g', 'google', 'Ana@gmail.com'), calendar('m', 'microsoft', 'bo@outlook.com'), calendar('h', 'subscription', '')],
      contacts: [{ id: 'c', name: 'iCloud', url: '', username: 'me@icloud.com', books: [] }],
      drives: [drive('Desktop', 'local'), drive('OneDrive', 'onedrive', 'bo@outlook.com'), drive('Nextcloud', 'webdav', 'ana')],
      googleDrive: { setUp: true, signedIn: true, account: 'ana@gmail.com', pending: null, hint: null },
      chat: [chat('Acme', 'slack')],
      providers: [provider('openai', true), provider('groq', false)],
      connectors: { running: ['github'], failed: [{ server: 'linear', error: 'needs sign-in', signIn: true }], problem: null },
      identities: [{ provider: 'google', email: 'ana@gmail.com' }, { provider: 'microsoft', email: 'zoe@outlook.com' }],
    });
    expect(rows.map((r) => [r.provider, r.address, accountLine(r)])).toEqual([
      ['Connector', 'github', 'Connectors'],
      ['Connector', 'linear', 'Sign in again'],
      ['Google', 'ana@gmail.com', 'Mail, Calendar, Files'],
      ['iCloud', 'me@icloud.com', 'Mail, Contacts'],
      ['Microsoft', 'bo@outlook.com', 'Calendar, Files'],
      ['Microsoft', 'zoe@outlook.com', 'Not on for any app'],
      ['OPENAI', 'OPENAI', 'Models'],
      ['Slack', 'Acme', 'Messages'],
      ['Subscription', 'h', 'Calendar'],
      ['WebDAV', 'ana', 'Files'],
    ]);
    expect(rows[2]!.key).toBe('google:ana@gmail.com');
  });

  it('says Sign in again when any part of an account needs it', () => {
    const [row] = gatherAccounts({ ...NO_SOURCES, mail: [mail('ana@gmail.com')], calendar: [calendar('g', 'google', 'ana@gmail.com', 'The Google sign-in has ended.')] });
    expect(accountLine(row!)).toBe('Sign in again');
    expect(row!.apps).toEqual(['Mail', 'Calendar']);
  });

  it('offers the switches each provider can serve, and keeps any app already on', () => {
    const [google] = gatherAccounts({ ...NO_SOURCES, identities: [{ provider: 'google', email: 'a@gmail.com' }] });
    expect(appsFor(google!)).toEqual(['Mail', 'Calendar', 'Files']);
    const [teams] = gatherAccounts({ ...NO_SOURCES, chat: [chat('bo@contoso.com', 'teams')] });
    expect([teams!.provider, appsFor(teams!)]).toEqual(['Microsoft', ['Calendar', 'Files', 'Messages']]);
    const [slack] = gatherAccounts({ ...NO_SOURCES, chat: [chat('Acme', 'slack')] });
    expect(appsFor(slack!)).toEqual(['Messages']);
  });

  it('names mail services and providers by the address', () => {
    expect(['a@gmail.com', 'a@outlook.com', 'a@icloud.com', 'a@fastmail.com', 'a@example.org'].map(mailService)).toEqual(['Gmail', 'Outlook', 'iCloud', 'Fastmail', 'Mail']);
    expect(['a@gmail.com', 'a@hotmail.com', 'a@example.org'].map((e) => providerOf(e, 'CalDAV'))).toEqual(['Google', 'Microsoft', 'CalDAV']);
  });
});

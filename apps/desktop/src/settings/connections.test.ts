import { describe, expect, it } from 'vitest';
import type { CalendarAccount, ChatAccount, DriveAccount, MailAccount, ProviderInfo } from '@mobius/shared';
import { connectionState, gatherConnections, mailService } from './connections';

const mail = (email: string, problem: string | null = null): MailAccount => ({ id: email, name: email, email, lastSyncMs: 0, problem });
const drive = (id: string, kind: DriveAccount['kind']): DriveAccount => ({ id, kind, name: id, url: '', username: '' });
const chat = (id: string, status: ChatAccount['status'], message?: string): ChatAccount => ({ id, service: 'slack', name: id, status, ...(message ? { message } : {}) });
const provider = (id: string, hasKey: boolean): ProviderInfo => ({ id, name: id.toUpperCase(), baseUrl: '', note: '', keyUrl: null, needsKey: true, hasKey, active: false, storage: 'keychain' });

describe('connections', () => {
  it('gathers every account under its kind, leaving out empty kinds, places on this computer and keyless gateways', () => {
    const groups = gatherConnections({
      mail: [mail('me@gmail.com')],
      calendar: [{ id: 'c', kind: 'caldav', name: 'Fastmail', url: '', username: '', calendars: [], taskLists: [], lastSyncMs: 0, problem: null } as CalendarAccount],
      drives: [drive('Desktop', 'local'), drive('Nextcloud', 'webdav')],
      chat: [],
      providers: [provider('openai', true), provider('groq', false)],
    });
    expect(groups.map((g) => [g.label, g.items.map((i) => i.account)])).toEqual([
      ['Mail and calendars', ['me@gmail.com', 'Fastmail']],
      ['Drives', ['Nextcloud']],
      ['Models', ['OPENAI']],
    ]);
    expect(groups[0]!.items[0]!.service).toBe('Gmail');
    expect(groups[2]!.items[0]!.adjust).toEqual({ section: 'providers' });
  });

  it('says what needs you in one sentence, and Connected otherwise', () => {
    const [g] = gatherConnections({ mail: [], calendar: [], drives: [], providers: [], chat: [chat('a', 'ready'), chat('b', 'signed-out'), chat('c', 'error', 'Token revoked.')] });
    expect(g!.items.map(connectionState)).toEqual(['Connected', 'Signed out. Sign in again to read and send.', 'Token revoked.']);
    expect(connectionState(gatherConnections({ mail: [mail('x@y.org', 'The password was refused.')], calendar: [], drives: [], chat: [], providers: [] })[0]!.items[0]!)).toBe('The password was refused.');
  });

  it('names mail services by their domain', () => {
    expect(['a@gmail.com', 'a@outlook.com', 'a@icloud.com', 'a@fastmail.com', 'a@example.org'].map(mailService)).toEqual(['Gmail', 'Outlook', 'iCloud', 'Fastmail', 'Mail']);
  });
});

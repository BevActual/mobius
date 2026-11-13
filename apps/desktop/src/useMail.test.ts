import { describe, expect, it } from 'vitest';
import type { MailContent, MailMessage } from '@mobius/shared';
import { forwarded, inBox, quoted, replyAllTo } from './useMail';

const person = (name: string, email: string) => ({ name, email });
const RUI: MailContent = {
  id: 'a/inbox/7', from: person('Rui Almeida', 'rui@example.com'), to: [person('Ana', 'ana@example.com'), person('Bea', 'bea@example.com')],
  cc: [person('', 'rui@example.com'), person('Caro', 'caro@example.com')], subject: 'Terrace', dateMs: Date.UTC(2026, 10, 8, 9, 2),
  text: 'Hi!\n\nEight on the 13th?\n\nRui\n\n', html: null, attachments: [],
};

describe('replies and forwards', () => {
  it('quotes the message under room to write, line by line', () => {
    const body = quoted(RUI);
    expect(body.startsWith('\n\nOn ')).toBe(true);
    expect(body).toContain('Rui Almeida <rui@example.com> wrote:\n> Hi!\n>\n> Eight on the 13th?\n>\n> Rui');
    expect(body.endsWith('> Rui')).toBe(true);
  });
  it('Reply All writes to the sender, copies everyone else once, and leaves you out', () => {
    expect(replyAllTo(RUI, ['ANA@example.com'])).toEqual({ to: 'rui@example.com', cc: 'bea@example.com, caro@example.com' });
  });
  it('Reply All to your own message still has someone to write to', () => {
    expect(replyAllTo({ ...RUI, from: person('Ana', 'ana@example.com'), to: [], cc: [] }, ['ana@example.com']).to).toBe('ana@example.com');
  });
  it('a forward carries who it was from, to whom, and the text', () => {
    const body = forwarded(RUI);
    expect(body).toContain('Begin forwarded message:\n\nFrom: Rui Almeida <rui@example.com>\nSubject: Terrace');
    expect(body).toContain('To: Ana <ana@example.com>, Bea <bea@example.com>');
    expect(body).toContain('Cc: rui@example.com, Caro <caro@example.com>');
    expect(body.endsWith('Rui')).toBe(true);
  });
});

describe('mailboxes', () => {
  const m = (id: string, more: Partial<MailMessage>): MailMessage => ({ id, account: 'a', box: 'inbox', uid: 1, from: person('', 'x@y.z'), to: [], cc: [], subject: id, dateMs: 0, seen: true, flagged: false, preview: '', category: 'primary', attachments: [], ...more });
  const all = [m('plain', {}), m('flagged', { flagged: true }), m('archived', { archived: true }), m('sent-flagged', { box: 'sent', flagged: true }), m('sent-archived', { box: 'sent', archived: true })];
  it('Flagged holds flagged mail from Inbox, Archive and Sent', () => {
    expect(inBox('flagged', all).map((x) => x.id)).toEqual(['flagged', 'sent-flagged']);
  });
  it('Archive holds archived inbox mail only', () => {
    expect(inBox('archive', all).map((x) => x.id)).toEqual(['archived']);
  });
});

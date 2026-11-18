import { useEffect, useState } from 'react';
import { isNotesFailure, type Contact, type MailMessage, type MailPerson } from '@mobius/shared';

/** The last few messages from someone, newest first: what a person card shows under their details. */
export function recentFrom(messages: readonly MailMessage[], email: string, limit = 5): MailMessage[] {
  const who = email.trim().toLowerCase();
  if (!who) return [];
  return messages.filter((m) => m.from.email.toLowerCase() === who).sort((a, b) => b.dateMs - a.dateMs).slice(0, limit);
}

type Card = { state: 'loading' } | { state: 'known'; contact: Contact } | { state: 'unknown' } | { state: 'unavailable' };

/** The card for an address from the address book, kept current when the book changes. */
function useContactCard(email: string): [Card, (c: Contact) => void] {
  const [card, setCard] = useState<Card>({ state: 'loading' });
  useEffect(() => {
    const book = window.mobius.contacts;
    if (!book || !email) { setCard({ state: 'unavailable' }); return undefined; }
    let live = true;
    const read = () => void book.byEmail(email).then((c) => {
      if (!live) return;
      if (isNotesFailure(c)) setCard({ state: 'unavailable' });
      else setCard(c ? { state: 'known', contact: c } : { state: 'unknown' });
    });
    setCard({ state: 'loading' });
    read();
    const off = book.onChanged(read);
    return () => { live = false; off(); };
  }, [email]);
  return [card, (contact) => setCard({ state: 'known', contact })];
}

/**
 * Mail's Contact panel (docs/design/panel-layouts.md: Mail's right dock): the open message's sender as the address book
 * has them, or a button to add them, and their recent mail. There is no People app; the book shows where people look.
 */
export function ContactPanel({ person, messages, onOpen }: { person: MailPerson | null; messages: readonly MailMessage[]; onOpen: (id: string) => void }) {
  const email = person?.email ?? '';
  const [card, setKnown] = useContactCard(email);
  const [problem, setProblem] = useState('');
  useEffect(() => setProblem(''), [email]);
  if (!person) return <p className="contact-empty">Open a message to see who it is from.</p>;
  const recent = recentFrom(messages, email);
  const add = async () => {
    const saved = await window.mobius.contacts?.save('', null, { name: person.name || email, emails: [email] });
    if (!saved || isNotesFailure(saved)) setProblem(saved?.message ?? 'Contacts are not available.');
    else setKnown(saved);
  };
  const c = card.state === 'known' ? card.contact : null;
  return (
    <div className="contact-card" aria-label="Contact">
      <div className="contact-head">
        <span className="contact-initial" aria-hidden="true">{(c?.name || person.name || email).trim().charAt(0).toUpperCase() || '?'}</span>
        <div className="contact-who">
          <strong className="contact-name">{c?.name || person.name || email}</strong>
          {c && (c.title || c.org) && <span className="contact-org">{[c.title, c.org].filter(Boolean).join(', ')}</span>}
        </div>
      </div>
      <dl className="contact-fields">
        {(c ? c.emails : [{ value: email, label: '' }]).map((e) => (
          <div key={`e:${e.value}`}><dt>{e.label || 'Email'}</dt><dd>{e.value}</dd></div>
        ))}
        {c?.phones.map((p) => <div key={`p:${p.value}`}><dt>{p.label || 'Phone'}</dt><dd>{p.value}</dd></div>)}
        {c?.birthday && <div><dt>Birthday</dt><dd>{c.birthday}</dd></div>}
      </dl>
      {c?.note && <p className="contact-note">{c.note}</p>}
      {card.state === 'unknown' && <button type="button" className="btn contact-add" onClick={() => void add()}>Add to contacts</button>}
      {problem && <p className="contact-problem" role="alert">{problem}</p>}
      {recent.length > 0 && (
        <section className="contact-recent" aria-label={`Recent mail from ${c?.name || person.name || email}`}>
          <h3 className="contact-recent-title">Recent mail</h3>
          {recent.map((m) => (
            <button key={m.id} type="button" className="contact-recent-row" onClick={() => onOpen(m.id)}>
              <span className="contact-recent-subject">{m.subject || '(no subject)'}</span>
              <span className="contact-recent-when">{new Date(m.dateMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

/** The address being typed: what follows the last comma in an address field, and what comes before it. */
export function lastAddress(value: string): { before: string; typing: string } {
  const cut = value.lastIndexOf(',');
  return cut < 0 ? { before: '', typing: value.trim() } : { before: `${value.slice(0, cut + 1)} `.replace(/\s+$/, ' '), typing: value.slice(cut + 1).trim() };
}

/** How a contact is written into an address field: `Name <email>`, or the address alone. */
export const addressOf = (name: string, email: string) => (name && name !== email ? `${name} <${email}>` : email);

/**
 * Names from the address book as an address is typed (docs/reference/build-plan.md, People): the whole field as it
 * would read with each match in place of the address being typed, for a native `<datalist>` under the field.
 */
export function useAddressSuggestions(value: string): string[] {
  const [found, setFound] = useState<string[]>([]);
  const { before, typing } = lastAddress(value);
  useEffect(() => {
    const book = window.mobius.contacts;
    if (!book || typing.length < 2 || (typing.includes('@') && typing.includes('>'))) { setFound([]); return undefined; }
    let live = true;
    const t = window.setTimeout(() => void book.search(typing, 8).then((people) => {
      if (!live || isNotesFailure(people)) return;
      setFound(people.flatMap((p) => p.emails.map((e) => before + addressOf(p.name, e.value))));
    }), 120);
    return () => { live = false; window.clearTimeout(t); };
  }, [before, typing]);
  return found;
}

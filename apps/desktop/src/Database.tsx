import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { onCommand } from './commands';
import { KEPT_EVENT, keepTurn, keptTurns, turnId } from './ReviewStrip';
import { showCell, tableQuery, toCsv } from './db-view';
import type { DatabasesState } from './useDatabases';

/** The databases, the open one's tables, and making or importing one. */
export function DatabaseSidebar({ db, pin, changed }: { db: DatabasesState; pin: ReactNode; changed?: ReadonlySet<string> }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => onCommand('new-database', () => setNaming(true)), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await db.create(name)) { setNaming(false); setName(''); }
  };
  return (
    <aside className="side db-side" aria-label="Database sidebar">
      <div className="side-head">
        <span className="side-title">Databases</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="Import a CSV file" title="Import a CSV file as a table" onClick={() => file.current?.click()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 14v2.5h12V14" /></svg>
          </button>
          <button type="button" className="strip-btn" aria-label="New database" title="New database" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      <input ref={file} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void db.importFile(f); }} />
      {naming && (
        <form className="notes-name" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Database name" placeholder="Database name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {db.list.length === 0 && !naming && (
        <div className="side-empty">
          <p>A database keeps data in tables you can ask questions of, in SQL or in words to Mobius. Start with a CSV file.</p>
          <button type="button" className="btn primary" onClick={() => file.current?.click()}>Import a CSV file</button>
        </div>
      )}
      <ul className="db-list" aria-label="Databases">
        {db.list.map((d) => (
          <li key={d.name}>
            <button type="button" className="note-row db-row" aria-current={db.open === d.name ? 'page' : undefined} data-changed={changed?.has(d.name) || undefined} onClick={() => void db.choose(d.name)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><ellipse cx="10" cy="5.5" rx="6" ry="2.5" /><path d="M4 5.5v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /></svg>
              <span>{d.name}</span>
            </button>
            {db.open === d.name && (
              <ul className="db-tables" aria-label={`Tables in ${d.name}`}>
                {d.tables.length === 0 && <li className="db-none">No tables yet</li>}
                {d.tables.map((t) => (
                  <li key={t.name}>
                    <button type="button" className="db-table" title={t.columns.map((c) => `${c.name} ${c.type}`.trim()).join(', ')} onClick={() => { db.setSql(tableQuery(t.name)); void db.run(tableQuery(t.name)); }}>
                      <span>{t.name}</span><span className="db-count">{t.rows < 0 ? '' : t.rows.toLocaleString()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Keep or discard what Mobius changed in a database in its last turn: the whole file goes back. */
function useDbReview(review: { conversation: string } | null | undefined, name: string | null) {
  const [kept, setKept] = useState(false);
  useEffect(() => {
    let live = true;
    const check = async () => {
      if (!review) { setKept(false); return; }
      const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
      const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
      if (live) setKept(id !== null && keptTurns().includes(id));
    };
    void check();
    window.addEventListener(KEPT_EVENT, check);
    return () => { live = false; window.removeEventListener(KEPT_EVENT, check); };
  }, [review?.conversation, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = async () => {
    if (!review) return;
    const last = await window.mobius.changes?.lastTurn(review.conversation).catch(() => null);
    const id = last && 'checkpoint' in last ? turnId(review.conversation, last.checkpoint) : null;
    if (id) keepTurn(id);
    setKept(true);
  };
  const discard = async () => {
    if (!review || !name) return;
    await window.mobius.changes.undoFile(review.conversation, `databases/${name}.sqlite`).catch(() => null);
  };
  return { show: Boolean(review) && !kept, keep, discard };
}

/** The open database: a statement to run, and what it gave as a table. */
export function DatabasePage({ db, review }: { db: DatabasesState; review?: { conversation: string } | null }) {
  const { show, keep, discard } = useDbReview(review, db.open);
  const [copied, setCopied] = useState(false);
  const r = db.result;
  if (!db.open) {
    return (
      <section className="db-page empty" aria-label="Database">
        <div className="db-empty">
          <h1>Ask questions of your data.</h1>
          <p>Import a CSV file to make a table, then query it in SQL, or ask Mobius in words. Databases are SQLite files in your workspace.</p>
        </div>
      </section>
    );
  }
  const info = db.list.find((d) => d.name === db.open);
  return (
    <section className="db-page" aria-label="Database">
      {show && (
        <div className="note-review db-review" role="status">
          <span className="review-dot" aria-hidden="true" />
          <span className="note-review-text">Mobius changed this database in its last turn.</span>
          <button type="button" className="review-btn" onClick={() => void discard()}>Discard</button>
          <button type="button" className="review-btn" data-kind="keep" onClick={() => void keep()}>Keep</button>
        </div>
      )}
      <form className="db-editor" onSubmit={(e) => { e.preventDefault(); void db.run(); }}>
        <textarea
          aria-label="SQL"
          spellCheck={false}
          placeholder={info?.tables[0] ? tableQuery(info.tables[0].name) : 'CREATE TABLE …'}
          value={db.sql}
          rows={4}
          onChange={(e) => db.setSql(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void db.run(); } }}
        />
        <div className="db-actions">
          <button type="submit" className="btn primary" disabled={!db.sql.trim() || db.running}>{db.running ? 'Running…' : 'Run'}</button>
          <span className="db-key">Ctrl+Enter</span>
          {db.history.length > 1 && (
            <select className="db-history" aria-label="Earlier queries" value="" onChange={(e) => { if (e.target.value) db.setSql(e.target.value); }}>
              <option value="">Earlier…</option>
              {db.history.map((q) => <option key={q} value={q}>{q.replace(/\s+/g, ' ').slice(0, 80)}</option>)}
            </select>
          )}
          <span className="db-gap" />
          {r?.ok && r.columns.length > 0 && <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(toCsv(r.columns, r.rows)).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copied' : 'Copy as CSV'}</button>}
        </div>
      </form>
      {db.message && <p className="db-message" role="alert">{db.message}</p>}
      <div className="db-result" aria-label="Result">
        {r && !r.ok && <p className="db-error" role="alert">{r.message}</p>}
        {r?.ok && r.columns.length === 0 && <p className="db-status" role="status">Done. {r.changed === 1 ? '1 row changed' : `${r.changed} rows changed`}, in {r.ms} ms.</p>}
        {r?.ok && r.columns.length > 0 && (
          <>
            <p className="db-status" role="status">{r.rows.length === 1 ? '1 row' : `${r.rows.length.toLocaleString()} rows`}{r.truncated ? ' (the first ones only)' : ''} · {r.ms} ms</p>
            <div className="db-grid-wrap">
              <table className="db-grid" aria-label="Rows">
                <thead><tr>{r.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={i}>{row.map((v, j) => <td key={j} data-kind={v === null ? 'null' : typeof v}>{showCell(v)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

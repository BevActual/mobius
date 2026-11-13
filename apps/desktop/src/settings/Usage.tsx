import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UsageRow } from '@mobius/shared';
import { appName } from '../apps';
import { dayLabel, systemLocale } from '../dates';
import { settingPath } from './manifest';
import { Empty, Row } from './primitives';
import type { SectionProps } from './sections';
import { GROUP_OPTIONS, RANGE_OPTIONS, byDay, costText, gatewayName, groupBy, rangeDays, shortCount, toCsv, total, type UsageGroup, type UsageRange } from './usage-data';

/** How each group's key reads: a service's name, an app's name, or the model's own id. */
function label(by: UsageGroup, key: string): string {
  if (by === 'gateway') return gatewayName(key);
  if (by === 'app') return key === 'agent' ? 'Mobius' : key === 'schedule' ? 'Schedules' : appName(key);
  return key;
}

/** A `YYYY-MM-DD` day as the computer writes dates: "12 Nov" or "Nov 12", with the weekday when asked. */
const dayOfText = (day: string, weekday = false) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return dayLabel(new Date(y, m - 1, d), weekday ? { weekday: 'short' } : {});
};

/**
 * Settings › Usage: the tokens model calls used on this computer and what they may have cost, by day, and grouped by
 * model, service or app. Costs are estimates from a public price list; calls on a plan have no price of their own.
 */
export function UsageSection({ subpage, highlight }: SectionProps) {
  const api = window.mobius.usage;
  const [range, setRange] = useState<UsageRange>('7d');
  const [by, setBy] = useState<UsageGroup>('model');
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const days = useMemo(() => rangeDays(range, new Date()), [range]);
  const load = useCallback(() => {
    if (!api) return;
    void api.query(days).then(setRows).catch(() => setRows([]));
  }, [api, days]);
  useEffect(() => { load(); return api?.onChange(load); }, [api, load]);
  const path = (row: string) => settingPath('usage', subpage, row);
  if (!api) return <Empty>Usage isn’t recorded in this version of Mobius yet.</Empty>;
  if (rows === null) return <Empty>Loading…</Empty>;

  const sum = total(rows);
  const perDay = byDay(rows, days.from, days.to);
  const groups = groupBy(rows, by);
  const most = Math.max(1, ...perDay.map((d) => d.inputTokens + d.outputTokens));
  const csv = () => toCsv(rows);
  const name = `Usage ${days.from} to ${days.to}.csv`;
  const exportCsv = async () => {
    const saved = await api.exportCsv?.(csv()).catch(() => null);
    if (saved && saved.ok) { setNote(`Saved to ${saved.path}.`); return; }
    const url = URL.createObjectURL(new Blob([csv()], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote(saved && !saved.ok ? `It could not be saved: ${saved.error}` : `Downloaded ${name}.`);
  };
  const copyCsv = async () => {
    const ok = await navigator.clipboard?.writeText(csv()).then(() => true, () => false);
    setNote(ok ? 'Copied as CSV.' : 'It could not be copied.');
  };

  return (
    <>
      <Row path={path('usage-period')} title="Period" description="Counted on this computer, from every model call Mobius makes." highlight={highlight === 'usage-period'}>
        <select className="popup" aria-label="Period" value={range} onChange={(e) => setRange(e.target.value as UsageRange)}>
          {RANGE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Row>
      <section className="srow usage-summary" data-setting={path('usage-summary')} aria-label="Totals">
        <dl className="usage-tiles">
          <div className="usage-tile"><dt>Tokens</dt><dd>{shortCount(sum.inputTokens + sum.outputTokens)}</dd><span>{shortCount(sum.inputTokens)} in · {shortCount(sum.outputTokens)} out</span></div>
          <div className="usage-tile"><dt>Estimated cost</dt><dd>{costText(sum)}</dd><span>{sum.unpriced ? (sum.planOnly ? 'Plan calls not priced' : 'Some prices are unknown') : 'From public prices'}</span></div>
          <div className="usage-tile"><dt>Requests</dt><dd>{sum.requests.toLocaleString(systemLocale())}</dd><span>{sum.cachedTokens > 0 ? `${shortCount(sum.cachedTokens)} tokens from cache` : 'Model calls'}</span></div>
        </dl>
      </section>
      <section className="srow usage-chart-row" data-setting={path('usage-chart')} aria-label="Tokens by day">
        <h3 className="srow-title">Tokens by day</h3>
        {sum.requests === 0 ? (
          <p className="srow-text usage-none">Nothing used in this period.</p>
        ) : (
          <div className="usage-chart" role="list" aria-label="Tokens by day">
            {perDay.map((d, i) => {
              const tokens = d.inputTokens + d.outputTokens;
              const tip = `${dayOfText(d.day, true)}: ${tokens.toLocaleString(systemLocale())} tokens, ${d.requests} ${d.requests === 1 ? 'request' : 'requests'}, ${costText(d)}`;
              return (
                <div key={d.day} className="usage-col" role="listitem" aria-label={tip} title={tip} tabIndex={0}>
                  <div className="usage-bar-track"><div className="usage-bar" style={{ height: `${tokens === 0 ? 0 : Math.max(2, (tokens / most) * 100)}%` }} /></div>
                  {/* Every day's date while they fit; on a longer period every other day, or every seventh, so none collide. */}
                  <span className="usage-day" aria-hidden="true">{i % (perDay.length <= 8 ? 1 : perDay.length <= 31 ? 3 : 7) === 0 ? dayOfText(d.day) : ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <Row path={path('usage-breakdown')} title="Breakdown" description="Each line sums the period. Cost is an estimate; calls on a plan are covered by it." highlight={highlight === 'usage-breakdown'}>
        <div className="usage-breakdown">
          <div className="settings-tabs usage-group" role="tablist" aria-label="Group by">
            {GROUP_OPTIONS.map((o) => <button key={o.id} type="button" role="tab" className="settings-tab" aria-selected={by === o.id} onClick={() => setBy(o.id)}>{o.label}</button>)}
          </div>
          {groups.length === 0 ? <p className="srow-text">Nothing used in this period.</p> : (
            <div className="usage-table-wrap">
            <table className="usage-table" aria-label={`Usage by ${GROUP_OPTIONS.find((o) => o.id === by)!.label.toLowerCase()}`}>
              <thead><tr><th scope="col">{GROUP_OPTIONS.find((o) => o.id === by)!.label}</th><th scope="col">Requests</th><th scope="col">Tokens in</th><th scope="col">Tokens out</th><th scope="col">Cost</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key}>
                    <th scope="row">{label(by, g.key)}</th>
                    <td>{g.requests.toLocaleString(systemLocale())}</td>
                    <td title={g.inputTokens.toLocaleString(systemLocale())}>{shortCount(g.inputTokens)}</td>
                    <td title={g.outputTokens.toLocaleString(systemLocale())}>{shortCount(g.outputTokens)}</td>
                    <td>{costText(g)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </Row>
      <Row path={path('usage-export')} title="Export" description="Every day, service, model and app as a CSV file, for a spreadsheet." highlight={highlight === 'usage-export'}>
        <span className="usage-actions">
          <button type="button" className="btn" disabled={rows.length === 0} onClick={() => void copyCsv()}>Copy as CSV</button>
          <button type="button" className="btn" disabled={rows.length === 0} onClick={() => void exportCsv()}>Export CSV…</button>
        </span>
        {note && <p className="srow-text" role="status">{note}</p>}
      </Row>
      <Row path={path('usage-clear')} title="Clear usage" description="Forget every count kept so far. It starts again from the next model call." highlight={highlight === 'usage-clear'}>
        {clearing ? (
          <span className="clist-confirm" role="group" aria-label="Confirm clearing usage">
            <button type="button" className="btn danger" onClick={() => void api.clear().then(() => { setClearing(false); setNote(null); load(); })}>Clear All Usage</button>
            <button type="button" className="btn" onClick={() => setClearing(false)}>Cancel</button>
          </span>
        ) : <button type="button" className="btn" onClick={() => setClearing(true)}>Clear Usage…</button>}
      </Row>
    </>
  );
}

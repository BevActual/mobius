import { Button, Menu, NumberField, Select } from './ui';
import { MAX_GROOVES, MAX_GROOVE_AMOUNT, type Groove, type Song } from './song-format';
import { BASE_CHOICES, GROOVE_LIBRARY, addGroove, grooveFrom, grooveUses, removeGroove } from './studio-groove';

/** The groove parameters the pool shows as percentages (Live 12, 14.1.1), with Velocity going below 0. */
const PARAMS: readonly { key: 'quantize' | 'timing' | 'random' | 'velocity'; name: string; title: string }[] = [
  { key: 'quantize', name: 'Quantize', title: 'How far notes snap to the Base grid before the groove moves them' },
  { key: 'timing', name: 'Timing', title: 'How far notes move toward the groove' },
  { key: 'random', name: 'Random', title: 'How much each note is pushed off its place, its own way' },
  { key: 'velocity', name: 'Velocity', title: 'How much the groove’s loud and quiet notes reach the clip’s; below 0 turns them round' },
];

/**
 * Music's Groove Pool (Live 12 manual, 14.1), in the left dock with the Browser as Live keeps it: the song's grooves with
 * their parameters, added from the library or extracted from a clip (its menu's Extract Groove), and Global Amount
 * over all of them. A groove no clip plays with is dimmed, as Live's Inactive grooves are.
 */
export function StudioGrooves({ song, setSong }: {
  song: Song;
  /** A change to the song, as one Undo step per `tag`. */
  setSong: (fn: (s: Song) => void, tag?: string) => void;
}) {
  const pool = song.grooves ?? [];
  const amount = song.grooveAmount ?? 1;
  const setGroove = (id: string, fn: (g: Groove) => void, tag: string) => setSong((s) => { const g = s.grooves?.find((x) => x.id === id); if (g) fn(g); }, `groove:${id}:${tag}`);
  return (
    <div className="studio-grooves" role="region" aria-label="Groove Pool">
      <div className="studio-grooves-bar" role="toolbar" aria-label="Groove Pool">
        <Menu label="Add groove" trigger={<Button kind="quiet" disabled={pool.length >= MAX_GROOVES} title="Add a groove from the library">Add groove</Button>}
          entries={GROOVE_LIBRARY.map((t) => ({ label: t.name, detail: `${t.base === 0.5 ? 'Eighths' : 'Sixteenths'}, every second one ${Math.round(t.swing * 100)}% of the way through the pair`, run: () => setSong((s) => { addGroove(s, grooveFrom(t, '')); }) }))} />
        <span className="studio-gap" />
        <NumberField label="Global Amount" value={Math.round(amount * 100)} min={0} max={Math.round(MAX_GROOVE_AMOUNT * 100)} step={5} decimals={0} width={3} unit="%"
          onChange={(v) => setSong((s) => { const a = Math.round(v) / 100; if (a === 1) delete s.grooveAmount; else s.grooveAmount = a; }, 'groove-amount')} />
      </div>
      {pool.length === 0 ? (
        <p className="studio-grooves-empty">No grooves yet. Add one from the library, or choose Extract Groove on a clip to take its timing and accents.</p>
      ) : (
        <ul className="studio-grooves-list" aria-label="Grooves">
          {pool.map((g) => {
            const uses = grooveUses(song, g.id);
            return (
              <li key={g.id} className="studio-groove" data-unused={uses === 0 || undefined} aria-label={g.name}>
                <div className="studio-groove-head">
                  <input className="studio-groove-name" aria-label="Groove name" value={g.name} maxLength={60} onChange={(e) => setGroove(g.id, (x) => { x.name = e.target.value; }, 'name')} />
                  <span className="studio-groove-uses">{uses === 0 ? 'Not used' : uses === 1 ? '1 clip' : `${uses} clips`}</span>
                  <Button kind="quiet" danger aria-label={`Remove ${g.name}`} title={uses ? 'Remove it: its clips play as written again' : 'Remove it'} onClick={() => setSong((s) => { removeGroove(s, g.id); })}>Remove</Button>
                </div>
                <div className="studio-groove-params">
                  <span className="studio-groove-param" title="The grid each groove note is measured against">
                    <Select inline label="Base" value={String(BASE_CHOICES.find((c) => Math.abs(Number(c.value) - g.base) < 1e-6)?.value ?? '0.25')} choices={BASE_CHOICES}
                      onChange={(v) => setGroove(g.id, (x) => { x.base = Number(v); }, 'base')} />
                  </span>
                  {PARAMS.map((p) => (
                    <span key={p.key} className="studio-groove-param" title={p.title}>
                      <NumberField label={p.name} value={Math.round(g[p.key] * 100)} min={p.key === 'velocity' ? -100 : 0} max={100} step={5} decimals={0} width={3} unit="%" signed={p.key === 'velocity'}
                        onChange={(v) => setGroove(g.id, (x) => { x[p.key] = Math.round(v) / 100; }, p.key)} />
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

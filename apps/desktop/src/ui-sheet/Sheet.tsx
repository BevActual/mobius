import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dayLabel, timeLabel, weekdayLabel } from '../dates';
import {
  Menu, Avatar, Button, Checkbox, Chip, Count, Dot, IconButton, ListRow, Meter, ParamCell, ParamGrid, Progress, Segmented, Select, Swatches, type ContentColor,
  Knob, EnvelopeGraph, FilterGraph, StepGrid, panLabel, type Envelope, type FilterValue,
  DeviceChain, DeviceFrame, EqGraph, type EqBand,
  Slider, StatusLetter, Dialog, Confirm, ContentTabs, ChoiceMenu, Popover, PopoverTitle, PopoverLink, StatusText, Switch, TextField, CONTENT_COLORS, ObjectCard, ObjectChip, ObjectRow, XYPad, type Thing, type PadPoint,
  WaveformView, peaksOf, type WaveRange,
  PadGrid, type Pad,
  DateField, TimeField, TimeRange, MonthPicker,
  NumberField, Readout, LetterToggle, Transport, LevelMeter, GainReductionMeter, barsLabel, clockLabel, type LevelFeed, type ReductionFeed,
} from '../ui';

/**
 * The reference sheet (Instrument, "One app, not twenty": one page that shows every shared element in its states).
 * Dev only: open /ui-sheet.html in `npm run dev`; add ?density=compact or ?theme=mid|cool. Reviews compare against it.
 */

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const PLUS = 'M12 5v14M5 12h14';
const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3';
const SHARE = 'M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5';
const LIST = 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01';
const BOARD = 'M4 4h6v16H4zM14 4h6v10h-6z';
const SHIELD = 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z';
const SEND = 'M12 19V5M6 11l6-6 6 6';
const CAL = 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4';

const when = (d: number, h?: number, m = 0) => (h === undefined ? dayLabel(new Date(2026, 10, d)) : timeLabel(new Date(2026, 10, d, h, m)));
const day = (d: number) => weekdayLabel(new Date(2026, 10, d));

/** Sample objects, in the shapes apps pass. Dates come through dates.ts, as in the apps. */
const THINGS: { kind: string; rows: Thing[] }[] = [
  { kind: 'Task', rows: [
    { kind: 'task', title: 'Book the sled for Friday', note: 'Dana has the yard contact', list: { name: 'P2 build', color: 'teal' }, steps: { done: 1, total: 2 }, due: day(15) },
    { kind: 'task', title: 'Pay the Veltro deposit', list: { name: 'P2 build', color: 'teal' }, flagged: true, due: 'Yesterday', overdue: true, from: 'Mail · Veltro Cells' },
    { kind: 'task', title: 'Bring the torque wrench', done: true, list: { name: 'Workshop', color: 'amber' } },
  ] },
  { kind: 'Event', rows: [
    { kind: 'event', title: 'Packs arrive', color: 'violet', place: 'Dock 2', day: day(19), time: when(19, 8, 40), range: `${when(19, 8, 40)} to ${when(19, 9, 30)}` },
    { kind: 'event', title: 'Design review', color: 'blue', place: 'Room 4', people: '5 people', day: day(19), time: when(19, 13), range: `${when(19, 13)} to ${when(19, 14, 30)}` },
    { kind: 'event', title: 'Prep the build week', color: 'violet', day: day(20), time: when(20, 14), byMobius: true },
  ] },
  { kind: 'Email', rows: [
    { kind: 'mail', from: 'Priya Nair', subject: 'P2 build dates', preview: 'Can you confirm the build week and send the plan to the team?', unread: true, when: when(13, 21, 32), whenLong: `today ${when(13, 21, 32)}` },
    { kind: 'mail', from: 'Veltro Cells', subject: 'Quote: 8 × 60 kWh packs', preview: 'Six weeks from order, with the deposit up front', when: day(12) },
    { kind: 'mail', from: 'Sam Okafor', subject: 'Motor call', preview: 'Axion can do Wednesday afternoon', when: day(12) },
  ] },
  { kind: 'File', rows: [
    { kind: 'file', name: 'Build brief', type: 'doc', app: 'Docs', folder: 'P2 build', extra: '179 words', changed: '1 hr ago' },
    { kind: 'file', name: 'P2 budget', type: 'sheet', app: 'Sheets', folder: 'P2 build', extra: '2 sheets', changed: '3 hr ago', byMobius: true, change: '2 cells in Sheet 1' },
    { kind: 'file', name: 'Alfama at dusk.jpg', type: 'image', app: 'Photo', folder: 'Lisbon', changed: when(3) },
  ] },
  { kind: 'Person', rows: [
    { kind: 'person', name: 'Priya Nair', role: 'Programme lead · Northway Motors', address: 'priya@northway.example', count: '3 emails', knows: 'Reads on her phone, keep mail short' },
    { kind: 'person', name: 'Sam Okafor', role: 'Owns the motor', address: 'sam@northway.example', count: '1 event' },
    { kind: 'person', name: 'Veltro Cells', address: 'sales@veltro.example', count: 'Supplier' },
  ] },
];

function Objects() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const tick = (t: Thing): Thing => (t.kind === 'task' && done[t.title] !== undefined ? { ...t, done: done[t.title] } : t);
  const toggle = (t: Thing) => (t.kind === 'task' ? () => setDone({ ...done, [t.title]: !(done[t.title] ?? t.done) }) : undefined);
  return (
    <div className="sheet-objects">
      {THINGS.map(({ kind, rows }) => (
        <div key={kind} className="sheet-object">
          <h3>{kind}</h3>
          <ul role="list" className="ui-list sheet-list">{rows.map((t, i) => <ObjectRow key={i} thing={tick(t)} current={i === 1} onOpen={() => {}} onToggle={toggle(t)} />)}</ul>
          <ul role="list" className="ui-list sheet-list">{rows.slice(0, 2).map((t, i) => <ObjectRow key={i} lines={2} thing={tick(t)} current={i === 1} onOpen={() => {}} onToggle={toggle(t)} />)}</ul>
          <ObjectCard thing={rows.find((r) => r.byMobius) ?? rows[kind === 'Person' ? 0 : 1]!} onOpen={() => {}} />
          <p className="sheet-chips">In text, {rows.slice(0, 2).map((t, i) => <span key={i}><ObjectChip thing={tick(t)} onOpen={() => {}} />{i === 0 ? ' and ' : ''}</span>)}</p>
        </div>
      ))}
    </div>
  );
}

function Pads() {
  const start = { x: 0.38, y: 0.42 };
  const [feel, setFeel] = useState<PadPoint>(start);
  const [moved, setMoved] = useState<PadPoint>({ x: 0.71, y: 0.73 });
  const axes = { x: { name: 'Bright', ends: ['Dark', 'Bright'] as const }, y: { name: 'Busy', ends: ['Calm', 'Busy'] as const } };
  return (
    <div className="sheet-grid sheet-pads">
      <div className="sheet-col"><span className="sheet-note">At rest (drag, click, arrows, Shift+arrows, Home)</span><XYPad label="Feel" {...axes} value={feel} start={start} onChange={setFeel} /></div>
      <div className="sheet-col"><span className="sheet-note">Moved from its start</span><XYPad label="Feel" {...axes} value={moved} start={start} onChange={setMoved} /></div>
      <div className="sheet-col"><span className="sheet-note">Disabled</span><XYPad label="Feel" {...axes} value={start} onChange={() => {}} disabled hideReadout /></div>
    </div>
  );
}

function Wave() {
  // A made-up two-bar loop: kicks and a decaying tail, so the shape has hits to trim around.
  const peaks = (() => {
    const samples = Array.from({ length: 4000 }, (_, i) => {
      const beat = (i % 500) / 500;
      return Math.sin(i * 0.9) * Math.exp(-beat * 6) * (i % 1000 < 500 ? 1 : 0.6) + Math.sin(i * 7.1) * 0.06;
    });
    return peaksOf(samples, 400);
  })();
  const [range, setRange] = useState<WaveRange>({ start: 0.12, end: 3.6, loop: { start: 1, end: 2 } });
  const [plain, setPlain] = useState<WaveRange>({ start: 0, end: 4, loop: null });
  return (
    <div className="sheet-waves">
      <div className="sheet-col"><span className="sheet-note">Trimmed, with a loop (drag an edge or its tab; arrows 10 ms, Shift 100 ms, Home and End). Playing at 1.4 s.</span>
        <WaveformView label="Sample" peaks={peaks} duration={4} value={range} onChange={setRange} playhead={1.4} /></div>
      <div className="sheet-col"><span className="sheet-note">Untrimmed, no loop: press the strip along the top to add one</span>
        <WaveformView label="Sample, no loop" peaks={peaks} duration={4} value={plain} onChange={setPlain} /></div>
    </div>
  );
}

function Instruments() {
  // Music's values: a pad's envelope and filter, its pan and drive, and the drum kit's first bar.
  const base: Envelope = { attack: 0.25, decay: 0.6, sustain: 0.7, release: 0.5 };
  const [env, setEnv] = useState<Envelope>({ attack: 0.012, decay: 0.3, sustain: 0.55, release: 0.8 });
  const [filt, setFilt] = useState<FilterValue>({ cutoff: 1800, resonance: 0.3 });
  const [sweep, setSweep] = useState(0.35);
  const [pan, setPan] = useState(-0.4);
  const [drive, setDrive] = useState(0);
  const [tune, setTune] = useState(0);
  const [kitDecay, setKitDecay] = useState(1);
  const drums = [['kick', 'Kick'], ['snare', 'Snare'], ['clap', 'Clap'], ['closed', 'Closed hat'], ['open', 'Open hat'], ['tom', 'Tom']].map(([id, name]) => ({ id: id!, name: name! }));
  const bar = (on: number[], v = 0.7, acc: number[] = []) => Array.from({ length: 16 }, (_, s) => (acc.includes(s) ? 1 : on.includes(s) ? v : 0));
  const [cells, setCells] = useState<number[][]>([
    bar([0, 4, 8, 12], 0.7, [0]), bar([4, 12], 0.7), bar([12], 0.5), bar([0, 2, 4, 6, 8, 10, 12, 14], 0.5, [2, 10]), bar([7, 15], 0.6), bar([], 0.7),
  ]);
  return (
    <div className="sheet-instruments">
      <div className="sheet-col"><span className="sheet-note">Envelope (drag a handle; arrows, Shift; on the decay corner Up and Down set sustain; double-click resets)</span>
        <EnvelopeGraph value={env} reset={base} onChange={setEnv} /></div>
      <div className="sheet-col"><span className="sheet-note">Filter, lowpass, with the envelope opening it (thin muted curve); Sweep drags in the readout</span>
        <FilterGraph value={filt} reset={{ cutoff: 1800, resonance: 0.2 }} min={80} max={12000} envAmount={sweep} envAmountReset={0.35} onEnvAmount={setSweep} onChange={setFilt} /></div>
      <div className="sheet-col"><span className="sheet-note">Knobs: arcs fill from the origin (pan from C, tune from 0, decay from 1×); values ink once off their default, grey at it</span>
        <div className="sheet-row">
          <Knob label="Pan" value={pan} min={-1} max={1} step={0.01} format={panLabel} onChange={setPan} />
          <Knob label="Drive" value={drive} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setDrive} />
          <Knob label="Tune" value={tune} min={-12} max={12} step={1} unit="st" format={(v) => (v > 0 ? `+${v}` : String(v))} onChange={setTune} />
          <Knob label="Decay" value={kitDecay} min={0.5} max={2} step={0.01} scale="log" origin={1} format={(v) => `${v.toFixed(2)}×`} onChange={setKitDecay} />
          <Knob label="Tone" value={0.5} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={() => {}} disabled />
        </div></div>
      <div className="sheet-col sheet-wide"><span className="sheet-note">Steps: an on-step is ink to its velocity, an accent full height; click, Shift+click accents, drag paints; arrows, Space, Shift+Enter, + and −. Step 5 playing.</span>
        <StepGrid label="Drums" rows={drums} cells={cells} now={4} onChange={(r, s, v) => setCells((c) => c.map((row, i) => (i === r ? row.map((x, j) => (j === s ? v : x)) : row)))} /></div>
    </div>
  );
}

function Devices() {
  const startBands: EqBand[] = [
    { type: 'lowshelf', freq: 120, gain: 0, q: 0.71 }, { type: 'peak', freq: 450, gain: 0, q: 1 },
    { type: 'peak', freq: 2500, gain: 0, q: 1 }, { type: 'highshelf', freq: 8000, gain: 0, q: 0.71 },
  ];
  const [bands, setBands] = useState<EqBand[]>([
    { type: 'lowshelf', freq: 120, gain: -4, q: 0.71 }, { type: 'peak', freq: 380, gain: -3, q: 2.2 },
    { type: 'peak', freq: 2800, gain: 4.5, q: 1.2 }, { type: 'highshelf', freq: 9000, gain: 2, q: 0.71 },
  ]);
  type Dev = { id: string; title: string; on: boolean; folded: boolean; proposed?: boolean };
  const [devs, setDevs] = useState<Dev[]>([
    { id: 'eq', title: 'EQ', on: true, folded: false },
    { id: 'drive', title: 'Drive', on: false, folded: false },
    { id: 'echo', title: 'Echo', on: true, folded: true, proposed: true },
  ]);
  const [drive, setDrive] = useState(0.35);
  const [tone, setTone] = useState(0.6);
  const patch = (id: string, p: Partial<Dev>) => setDevs((d) => d.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const move = (from: number, to: number) => setDevs((d) => { const next = [...d]; const [x] = next.splice(from, 1); next.splice(to, 0, x!); return next; });
  return (
    <div className="sheet-col"><span className="sheet-note">A chain in signal order: drag a grip or use its arrow keys; the switch bypasses (dims, still editable); fold shows the head alone; Echo was added by Mobius (dashed). EQ: drag a dot, wheel or Alt+drag for Q, Alt+Up/Down on a focused dot.</span>
      <DeviceChain label="Bass effects" count={devs.length} onMove={move}>
        {devs.map((d, i) => (
          <DeviceFrame key={d.id} title={d.title} index={i} on={d.on} onToggle={(on) => patch(d.id, { on })} collapsed={d.folded} onCollapse={(folded) => patch(d.id, { folded })} proposed={d.proposed}>
            {d.id === 'eq' && <div className="sheet-eq"><EqGraph bands={bands} reset={startBands} onChange={(i, b) => setBands((all) => all.map((x, j) => (j === i ? b : x)))} /></div>}
            {d.id === 'drive' && <div className="sheet-row"><Knob label="Drive" value={drive} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setDrive} /><Knob label="Tone" value={tone} min={0} max={1} step={0.01} origin={0.5} format={(v) => `${Math.round(v * 100)}%`} onChange={setTone} /></div>}
            {d.id === 'echo' && <span className="sheet-note">Time, feedback, mix</span>}
          </DeviceFrame>
        ))}
      </DeviceChain>
      <span className="sheet-note">Stacked (orientation=&quot;vertical&quot;) in a 340 wide panel: drag a grip up or down. Knobs four across with ParamGrid columns=4.</span>
      <div className="sheet-side">
        <DeviceChain label="Bass effects, stacked" count={devs.length} onMove={move} orientation="vertical">
          {devs.map((d, i) => (
            <DeviceFrame key={d.id} title={d.title} index={i} on={d.on} onToggle={(on) => patch(d.id, { on })} collapsed={d.folded} onCollapse={(folded) => patch(d.id, { folded })} proposed={d.proposed}>
              {d.id === 'eq' && <EqGraph bands={bands} reset={startBands} onChange={(i, b) => setBands((all) => all.map((x, j) => (j === i ? b : x)))} />}
              {d.id === 'drive' && (
                <ParamGrid label="Drive" columns={4}>
                  <Knob label="Drive" value={drive} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setDrive} />
                  <Knob label="Tone" value={tone} min={0} max={1} step={0.01} origin={0.5} format={(v) => `${Math.round(v * 100)}%`} onChange={setTone} />
                  <Knob label="Mix" value={1} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={() => {}} />
                  <Knob label="Out" value={0} min={-12} max={12} step={0.1} origin={0} format={(v) => `${v.toFixed(1)}`} unit="dB" onChange={() => {}} />
                </ParamGrid>
              )}
              {d.id === 'echo' && <span className="sheet-note">Time, feedback, mix</span>}
            </DeviceFrame>
          ))}
        </DeviceChain>
      </div>
    </div>
  );
}

function DrumPads() {
  const names = ['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Tom', 'Rim', 'Shaker', 'Low tom', 'Crash', 'Cowbell', 'Perc'];
  const keys = ['Z', 'X', 'C', 'V', 'A', 'S', 'D', 'F', 'Q', 'W', 'E', 'R', '1', '2', '3', '4'];
  const colors = ['coral', 'amber', 'yellow', 'teal', 'teal', 'violet', 'stone', 'green', 'violet', 'blue', 'pink', 'stone'] as const;
  const pads: Pad[] = keys.map((key, i) => (names[i]
    ? { id: `p${i}`, name: names[i]!, key, color: colors[i], proposed: i === 7 }
    : { id: `p${i}`, name: `Pad ${i + 1}`, key, empty: true }));
  const [chosen, setChosen] = useState(1);
  const [lit, setLit] = useState<number[]>([0]);
  const [tune, setTune] = useState(0);
  return (
    <div className="sheet-col"><span className="sheet-note">Press to play and choose (higher on a pad is louder); arrows move, Space plays, a pad&apos;s key plays it. Kick is sounding; Shaker was changed by Mobius (dashed).</span>
      <PadGrid label="Drum kit" pads={pads} chosen={chosen} lit={lit} onChoose={setChosen} onPlay={(i) => { setLit([i]); setTimeout(() => setLit([]), 120); }}>
        <div className="sheet-row"><Slider label="Tune" value={tune} min={-12} max={12} step={1} format={(v) => (v > 0 ? `+${v} st` : `${v} st`)} onChange={setTune} /></div>
      </PadGrid>
    </div>
  );
}

function Composer() {
  const [mode, setMode] = useState<'agent' | 'ask' | 'plan'>('agent');
  const [perm, setPerm] = useState<'ask' | 'review' | 'apply' | 'auto'>('review');
  const [model, setModel] = useState<'best' | 'quick' | 'deep'>('best');
  const [web, setWeb] = useState(true);
  const [know, setKnow] = useState(true);
  const quiet = (text: string, label: string) => <Button kind="quiet" aria-label={label}>{text} <span aria-hidden="true">⌄</span></Button>;
  return (
    <div className="sheet-composer">
      <Popover label="More for this chat" side="top" trigger={<IconButton label="More for this chat" icon={<Icon d={PLUS} />} />}>
        <PopoverTitle>This chat</PopoverTitle>
        <Switch label="Web search" checked={web} onChange={setWeb} />
        <Switch label="Knowledge" detail="Reads and adds to Knowledge" checked={know} onChange={setKnow} />
        <PopoverLink onClick={() => {}}>Manage in Abilities</PopoverLink>
      </Popover>
      <ChoiceMenu label="Mode" title="Mode" value={mode} onChange={setMode} trigger={quiet({ agent: 'Agent', ask: 'Ask', plan: 'Plan' }[mode], 'Mode')}
        choices={[{ value: 'agent', label: 'Agent', keys: 'Ctrl+1' }, { value: 'ask', label: 'Ask', keys: 'Ctrl+2' }, { value: 'plan', label: 'Plan', keys: 'Ctrl+3' }]} />
      <ChoiceMenu label="Permission" title="Permission" value={perm} onChange={setPerm} trigger={<Button kind="quiet" aria-label="Permission" icon={<Icon d={SHIELD} />}>{{ ask: 'Ask', review: 'Review', apply: 'Apply', auto: 'Auto' }[perm]} <span aria-hidden="true">⌄</span></Button>}
        choices={[
          { value: 'ask', label: 'Ask each time', meaning: 'Mobius asks before every step' },
          { value: 'review', label: 'Review changes', meaning: 'Changes show dashed until you keep them' },
          { value: 'apply', label: 'Apply changes', meaning: 'Changes go in; Undo takes them back' },
          { value: 'auto', label: 'Auto', meaning: 'Runs on its own in apps you switched on' },
        ]} footer={[{ label: 'Always ask and never lists', run: () => {} }]} />
      <span className="sheet-spacer" />
      <ChoiceMenu label="Model" title="Model" value={model} onChange={setModel} align="end" trigger={quiet({ best: 'Best fit', quick: 'Quick', deep: 'Deep' }[model], 'Model')}
        choices={[{ value: 'best', label: 'Best fit', meaning: 'Picks the model for each step' }, { value: 'quick', label: 'Quick', meaning: 'Fast answers for small jobs' }, { value: 'deep', label: 'Deep', meaning: 'Slower, for long and careful work' }]} />
      <IconButton label="Send" keys="Enter" primary icon={<Icon d={SEND} />} />
    </div>
  );
}

function Floating() {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState('P2 budget');
  const [tabs, setTabs] = useState([
    { id: 'brief', label: 'Build brief.md' }, { id: 'budget', label: 'P2 budget.xlsx', unsaved: true }, { id: 'plan', label: 'Launch plan for the Northway dealer preview.md' }, { id: 'motor', label: 'motor.ts', byMobius: true },
  ]);
  const [tab, setTab] = useState('budget');
  return (
    <div className="sheet-col">
      <ContentTabs label="Open files" tabs={tabs} value={tab} onChange={setTab} onClose={(id) => setTabs(tabs.filter((t) => t.id !== id))}
        trailing={<IconButton label="New tab" keys="Ctrl+T" icon={<Icon d={PLUS} />} />} />
      <div className="sheet-row" style={{ marginTop: 12 }}>
        <Button onClick={() => setDialog(true)}>Rename…</Button>
        <Button onClick={() => setConfirm(true)}>Delete 3 files…</Button>
      </div>
      <Dialog open={dialog} onOpenChange={setDialog} title="Rename sheet" description="The new name shows everywhere this sheet is linked."
        actions={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button kind="primary" onClick={() => setDialog(false)}>Rename</Button></>}>
        <TextField label="Name" value={name} onChange={setName} />
      </Dialog>
      <Confirm open={confirm} title="Delete 3 files?" description="They leave P2 build and every app that shows them." permanent action="Delete 3 files" onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} />
    </div>
  );
}

function Card({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return <section className="sheet-card" data-wide={wide || undefined}><h2>{title}</h2>{children}</section>;
}

export function Sheet() {
  const [name, setName] = useState('Kestrel P2 build');
  const [width, setWidth] = useState('1280');
  const [tone, setTone] = useState<'plain' | 'warm' | 'formal'>('warm');
  const [grid, setGrid] = useState<'1/8' | '1/16' | '1/32'>('1/16');
  const [noteLength, setNoteLength] = useState<'1/4' | '1/8d' | '1/16t'>('1/16t');
  const [key, setKey] = useState<'C' | 'Am' | 'G'>('Am');
  const [swatch, setSwatch] = useState<ContentColor>('teal');
  const [view, setView] = useState<'list' | 'board' | 'calendar'>('list');
  const [fit, setFit] = useState<'fit' | 'fill'>('fit');
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [done, setDone] = useState(true);
  const [exposure, setExposure] = useState(12);
  const [contrast, setContrast] = useState(0);
  const [length, setLength] = useState(40);
  const [cutoff, setCutoff] = useState(2400);
  const [tempo, setTempo] = useState(124);
  const [decay, setDecay] = useState(0.42);
  const [level, setLevel] = useState(-6);
  const [current, setCurrent] = useState(1);
  const [filter, setFilter] = useState(true);
  const [tags, setTags] = useState(['Launch', 'Northway', 'Supplier']);

  return (
    <main className="sheet">
      <header>
        <h1>Shared controls</h1>
        <p>Every control in src/ui, in its states. Instrument, docs/design/instrument.md.</p>
      </header>
      <div className="sheet-grid">
        <Card title="Buttons">
          <div className="sheet-row">
            <Button kind="primary" keys="Ctrl+Enter">Keep</Button>
            <Button>Export</Button>
            <Button kind="quiet">Discard</Button>
            <Button kind="quiet">Try another</Button>
          </div>
          <div className="sheet-row">
            <Button icon={<Icon d={PLUS} />}>New task</Button>
            <Button pressed>Pressed</Button>
            <Button kind="quiet" danger>Delete</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="sheet-row">
            <IconButton label="Share" icon={<Icon d={SHARE} />} />
            <IconButton label="New" keys="Ctrl+N" icon={<Icon d={PLUS} />} pressed />
            <IconButton label="Delete" keys="Delete" icon={<Icon d={TRASH} />} danger />
            <IconButton label="Unavailable" icon={<Icon d={PLUS} />} disabled />
          </div>
        </Card>

        <Card title="Fields and pop-ups">
          <div className="sheet-col">
            <TextField label="Name" value={name} onChange={setName} />
            <TextField label="Width" value={width} onChange={setWidth} unit="px" inputMode="numeric" />
            <TextField label="Email" value="kestrel@" onChange={() => {}} error="That is not a whole address. Add the part after @." />
            <Select label="Tone" value={tone} onChange={setTone} choices={[{ value: 'plain', label: 'Plain' }, { value: 'warm', label: 'Warm' }, { value: 'formal', label: 'Formal' }]} />
            <Select label="Grid" inline value={grid} onChange={setGrid} choices={[{ value: '1/8', label: '1/8' }, { value: '1/16', label: '1/16' }, { value: '1/32', label: '1/32' }]} />
            <div className="sheet-bar" aria-label="A crowded bar">
              <Select label="Grid" inline value={grid} onChange={setGrid} choices={[{ value: '1/8', label: '1/8' }, { value: '1/16', label: '1/16' }, { value: '1/32', label: '1/32' }]} />
              <Select label="Note length" inline value={noteLength} onChange={setNoteLength} choices={[{ value: '1/4', label: '1/4' }, { value: '1/8d', label: '1/8 dotted' }, { value: '1/16t', label: '1/16 triplet' }]} />
              <span className="sheet-bar-fill">Notes bar, squeezed</span>
            </div>
            <div className="sheet-row">
              <span className="sheet-sub">Key</span>
              <Select label="Key" hideLabel quiet value={key} onChange={setKey} choices={[{ value: 'C', label: 'C major' }, { value: 'Am', label: 'A minor' }, { value: 'G', label: 'G major' }]} />
            </div>
            <Swatches label="Track colour" value={swatch} onChange={setSwatch} />
          </div>
        </Card>

        <Card title="Segmented">
          <div className="sheet-row">
            <Segmented label="View" value={view} onChange={setView} choices={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }, { value: 'calendar', label: 'Calendar' }]} />
            <Segmented label="View" iconOnly value={view} onChange={setView} choices={[{ value: 'list', label: 'List', icon: <Icon d={LIST} /> }, { value: 'board', label: 'Board', icon: <Icon d={BOARD} /> }, { value: 'calendar', label: 'Calendar', icon: <Icon d={CAL} /> }]} />
          </div>
          <div className="sheet-row">
            <Segmented label="Size" wide value={fit} onChange={setFit} choices={[{ value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }]} />
          </div>
          <div className="sheet-row">
            <Segmented label="Disabled" disabled value={fit} onChange={setFit} choices={[{ value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }]} />
          </div>
        </Card>

        <Card title="Switches and checkboxes">
          <div className="sheet-col">
            <Switch label="Show key hints" checked={on} onChange={setOn} />
            <Switch label="Keep my wording" detail="Mobius changes only what you ask" checked={off} onChange={setOff} />
            <Switch label="Unavailable" checked onChange={() => {}} disabled />
          </div>
          <div className="sheet-row">
            <Checkbox label="Done" checked={done} onChange={setDone} />
            <Checkbox label="Not done" checked={false} onChange={() => {}} />
            <Checkbox label="Some" checked indeterminate onChange={() => {}} />
            <Checkbox label="Disabled" checked={false} disabled onChange={() => {}} />
          </div>
        </Card>

        <Card title="Sliders (Adjust)">
          <div className="sheet-panel">
            <Slider label="Exposure" min={-100} max={100} value={exposure} onChange={setExposure} />
            <Slider label="Contrast" min={-100} max={100} value={contrast} onChange={setContrast} />
            <Slider label="Length" value={length} onChange={setLength} ends={['Shorter', 'Longer']} remake hideValue />
            <Slider label="Cutoff" min={20} max={20000} step={1} scale="log" value={cutoff} onChange={setCutoff} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`)} />
            <Slider label="Disabled" value={30} onChange={() => {}} disabled />
          </div>
        </Card>

        <Card title="Parameter cells (pro apps)">
          <div className="sheet-panel">
            <ParamGrid label="Device">
              <ParamCell label="Tempo" unit="BPM" min={40} max={240} value={tempo} onChange={setTempo} keyHint="T" />
              <ParamCell label="Decay" unit="s" min={0} max={2} step={0.01} value={decay} onChange={setDecay} format={(v) => v.toFixed(2)} keyHint="D" />
              <ParamCell label="Level" unit="dB" min={-60} max={6} step={0.5} value={level} onChange={setLevel} format={(v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))} />
              <ParamCell label="Cutoff" unit="Hz" min={20} max={20000} scale="log" value={cutoff} onChange={setCutoff} format={(v) => String(Math.round(v))} />
            </ParamGrid>
            <ParamGrid label="Track" columns={1}>
              <ParamCell label="Volume" unit="dB" min={-60} max={6} step={0.5} value={level} onChange={setLevel} format={(v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))} />
            </ParamGrid>
            <span className="sheet-note">Compact (size=&quot;compact&quot;): a dense Device panel</span>
            <ParamGrid label="Device, compact" columns={3}>
              <ParamCell size="compact" label="Cutoff" unit="Hz" min={20} max={20000} scale="log" value={cutoff} onChange={setCutoff} format={(v) => String(Math.round(v))} />
              <ParamCell size="compact" label="Decay" unit="s" min={0} max={2} step={0.01} value={decay} onChange={setDecay} format={(v) => v.toFixed(2)} />
              <ParamCell size="compact" label="Level" unit="dB" min={-60} max={6} step={0.5} value={level} onChange={setLevel} format={(v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))} />
            </ParamGrid>
            <Menu label="Add effect" trigger={<Button>Add effect (menu with details)</Button>} entries={[
              { label: 'EQ', detail: 'Shape the tone, band by band', run: () => {} },
              { label: 'Echo', detail: 'Repeats that fade', run: () => {} },
              { label: 'Drive', detail: 'Warmth and grit', run: () => {} },
            ]} />
          </div>
        </Card>

        <Card title="Meters and progress">
          <div className="sheet-col">
            <Meter label="Storage" value={0.62} />
            <Meter label="Level" value={0.94} threshold={0.85} format={() => '−0.4 dB'} />
            <Progress label="Exporting" value={0.4} />
          </div>
        </Card>

        <Card title="Chips, counts, dots and people">
          <div className="sheet-row">
            {tags.map((t, i) => <Chip key={t} color={CONTENT_COLORS[i * 3]} onRemove={() => setTags(tags.filter((x) => x !== t))}>{t}</Chip>)}
            <Chip color="violet">Design</Chip>
            <Chip onClick={() => setFilter(!filter)} pressed={filter}>Unread</Chip>
          </div>
          <div className="sheet-row">
            <span className="sheet-note">Content colours:</span>
            {CONTENT_COLORS.map((c) => <Dot key={c} color={c} label={c} />)}
            <span className="sheet-note">Status (the one status colour):</span>
            <Dot color="red" label="Overdue" />
          </div>
          <div className="sheet-row">
            <Avatar name="Ada Lovelace" />
            <Avatar name="maya.chen@northway.example" />
            <Avatar name="Sam Okafor" size="large" />
            <span className="sheet-note">Count:</span><Count n={12} label="unread" /><Count n={1240} />
            <span className="sheet-note">Git:</span><StatusLetter letter="M" meaning="Modified" /><StatusLetter letter="A" meaning="Added" /><StatusLetter letter="C" meaning="Conflict" tone="red" />
          </div>
          <div className="sheet-row">
            <StatusText>Connected</StatusText>
            <StatusText>Key saved</StatusText>
            <StatusText problem>Couldn’t reach the server. Check the address and try again.</StatusText>
          </div>
        </Card>

        <Card title="Shared objects: one-line row, two-line row, card, chip" wide>
          <Objects />
        </Card>

        <Card title="Popover and choice menus (composer: plus, Mode, Permission, model open upward)" wide>
          <Composer />
        </Card>

        <Card title="Content tabs and dialogs" wide>
          <Floating />
        </Card>

        <Card title="Pro controls (Music: tempo, position, transport, track letters, levels)" wide>
          <ProControls />
        </Card>

        <Card title="Date and time fields (open downward)" wide>
          <Dates />
        </Card>

        <Card title="Two-axis pad" wide>
          <Pads />
        </Card>

        <Card title="Waveform (Music's sampler)" wide>
          <Wave />
        </Card>
        <Card title="Instrument controls (Music's Device panel and drum kit)" wide>
          <Instruments />
        </Card>
        <Card title="Devices: chain, frame and EQ" wide>
          <Devices />
        </Card>
        <Card title="Pad grid (Music's drum kit)">
          <DrumPads />
        </Card>
        <Card title="List rows" wide>
          <div className="sheet-grid">
            <ul role="list" className="ui-list sheet-list">
              {[
                { t: 'Supplier quote for the P2 harness', m: timeLabel(new Date(2026, 10, 14, 9, 14)), d: 'Maya Chen · The revised numbers are attached, with the longer lead time', u: true },
                { t: 'Northway launch plan', m: dayLabel(Date.now() - 86_400_000), d: 'Sam Okafor · Moved the dealer preview to the week after', u: false },
                { t: 'Paint shop booking', m: dayLabel(new Date(2026, 10, 11)), d: 'Workshop · Confirmed for two bays', u: false, p: true },
              ].map((r, i) => (
                <ListRow key={r.t} title={r.t} meta={r.m} detail={r.d} unread={r.u} proposed={r.p} current={i === current} lead={<Avatar name={r.d.split(' · ')[0]!} />} onSelect={() => setCurrent(i)} />
              ))}
            </ul>
            <ul role="list" className="ui-list sheet-list">
              {['Order the harness samples', 'Book the paint shop', 'Send the dealer preview invite', 'Review the launch budget'].map((t, i) => (
                <ListRow key={t} title={t} meta={i === 3 ? undefined : dayLabel(new Date(2026, 10, [13, 14, 18][i]!))} lead={<Checkbox label={t} hideLabel checked={i === 0} onChange={() => {}} />} trail={i === 1 ? <Chip color="teal">Workshop</Chip> : undefined} onSelect={() => {}} />
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </main>
  );
}

/** A fixed "today" so the sheet and its shots don't move: Saturday 14 November 2026, 10:05. */
const SHEET_NOW = new Date(2026, 10, 14, 10, 5);

function Dates() {
  const [due, setDue] = useState<Date | null>(new Date(2026, 10, 20));
  const [none, setNone] = useState<Date | null>(null);
  const [start, setStart] = useState<number | null>(13 * 60);
  const [end, setEnd] = useState<number | null>(14 * 60 + 30);
  const [at, setAt] = useState<number | null>(null);
  const [day, setDay] = useState<Date | null>(new Date(2026, 10, 20));
  return (
    <div className="sheet-grid">
      <div className="sheet-stack">
        <DateField label="Due" value={due} onChange={(d) => setDue(d)} now={SHEET_NOW} />
        <DateField label="Starts" value={none} onChange={(d) => setNone(d)} now={SHEET_NOW} />
        <DateField label="Mobius proposed" value={new Date(2026, 10, 21)} onChange={() => {}} proposed now={SHEET_NOW} />
        <TimeField label="Remind me at" value={at} onChange={setAt} now={SHEET_NOW} />
        <div className="ui-field">
          <span className="ui-field-label">Design review</span>
          <TimeRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} now={SHEET_NOW} />
        </div>
      </div>
      <div className="sheet-month">
        <MonthPicker value={day} onPick={setDay} now={SHEET_NOW} label="Month on its own" />
      </div>
    </div>
  );
}

function ProControls() {
  const [tempo, setTempo] = useState(120);
  const [bars, setBars] = useState(16);
  const [transpose, setTranspose] = useState(-3);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [click, setClick] = useState(false);
  const [rec, setRec] = useState(false);
  const [tracks, setTracks] = useState([
    { name: 'Drums', m: false, s: true, r: false },
    { name: 'Bass', m: false, s: false, r: true },
    { name: 'Keys', m: true, s: false, r: false },
  ]);
  const anySolo = tracks.some((t) => t.s);
  const flip = (i: number, k: 'm' | 's' | 'r') => setTracks((ts) => ts.map((t, j) => (j === i ? { ...t, [k]: !t[k] } : t)));
  const beats = 45.25; // 12 . 2 . 2 at 4/4
  const meters = [useRef<LevelFeed>(null), useRef<LevelFeed>(null), useRef<LevelFeed>(null)];
  const levels = [[-14, -11], [-6, -7.5], [2.5, -1]];
  const [threshold, setThreshold] = useState(-18);
  const busIn = useRef<LevelFeed>(null);
  const reduce = useRef<ReductionFeed>(null);
  useEffect(() => {
    // Fixed levels so the sheet and its shots hold still; ?live=1 moves them.
    meters.forEach((m, i) => m.current?.set(...levels[i]!));
    busIn.current?.set(-9, -11);
    reduce.current?.set(6.4);
    reduce.current?.set(4.2);
    if (!new URLSearchParams(location.search).has('live')) return;
    const timer = setInterval(() => {
      meters.forEach((m, i) => m.current?.set(...levels[i]!.map((d) => d - Math.random() * 12)));
      const level = -6 - Math.random() * 14;
      busIn.current?.set(level, level - 2);
      reduce.current?.set(Math.max(0, (level + 18) * 0.75));
    }, 33);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sheet-pro">
      <div className="sheet-row">
        <Transport playing={playing} onPlay={() => setPlaying((p) => !p)} onStop={() => setPlaying(false)} recording={rec} onRecord={() => setRec((r) => !r)} loop={loop} onLoop={() => setLoop((l) => !l)} metronome={click} onMetronome={() => setClick((c) => !c)} />
        <Readout label="Position" size="lg" formats={[{ name: 'Bars', text: barsLabel(beats) }, { name: 'Time', text: clockLabel((beats * 60) / tempo) }]} />
        <NumberField label="Tempo" hideLabel value={tempo} onChange={setTempo} min={30} max={300} reset={120} unit="BPM" />
        <Readout label="Time signature" formats={[{ name: '', text: '4/4' }]} />
      </div>
      <div className="sheet-row">
        <NumberField label="Tempo" value={tempo} onChange={setTempo} min={30} max={300} reset={120} unit="BPM" />
        <NumberField label="Length" value={bars} onChange={setBars} min={1} max={256} reset={16} unit="bars" />
        <NumberField label="Transpose" value={transpose} onChange={setTranspose} min={-24} max={24} reset={0} signed unit="st" />
        <NumberField label="Swing" value={0} onChange={() => {}} min={0} max={100} unit="%" disabled />
        <Readout label="Selection" copy formats={[{ name: 'Time', text: '0:22.5' }]} />
      </div>
      <div className="sheet-row sheet-tracks">
        {tracks.map((t, i) => (
          <div key={t.name} className="sheet-track">
            <span className="sheet-track-name">{t.name}</span>
            <LetterToggle letter="M" label={`Mute ${t.name}`} pressed={t.m} onChange={() => flip(i, 'm')} dimmed={anySolo && !t.s} />
            <LetterToggle letter="S" label={`Solo ${t.name}`} pressed={t.s} onChange={() => flip(i, 's')} />
            <LetterToggle letter="R" label={`Arm ${t.name}`} pressed={t.r} onChange={() => flip(i, 'r')} armed />
            <LevelMeter ref={meters[i]} label={`${t.name} level`} />
          </div>
        ))}
        <div className="sheet-track">
          <span className="sheet-track-name">Bus in</span>
          <LevelMeter ref={busIn} label="Bus input" threshold={threshold} thresholdReset={-18} onThreshold={setThreshold} />
          <span className="sheet-track-name sheet-gap">Reduction</span>
          <GainReductionMeter ref={reduce} label="Bus gain reduction" />
        </div>
      </div>
    </div>
  );
}

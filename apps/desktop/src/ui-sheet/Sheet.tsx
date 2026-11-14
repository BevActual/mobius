import { useState, type ReactNode } from 'react';
import { dayLabel, timeLabel, weekdayLabel } from '../dates';
import {
  Avatar, Button, Checkbox, Chip, Count, Dot, IconButton, ListRow, Meter, ParamCell, ParamGrid, Progress, Segmented, Select, Swatches, type ContentColor,
  Slider, StatusLetter, ChoiceMenu, Popover, PopoverTitle, PopoverLink, StatusText, Switch, TextField, CONTENT_COLORS, ObjectCard, ObjectChip, ObjectRow, XYPad, type Thing, type PadPoint,
  Knob, EnvelopeGraph, FilterGraph, StepGrid, panLabel, type Envelope, type FilterValue,
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

function Instruments() {
  // Music's values: a pad's envelope and filter, its pan and drive, and the drum kit's first bar.
  const base: Envelope = { attack: 0.25, decay: 0.6, sustain: 0.7, release: 0.5 };
  const [env, setEnv] = useState<Envelope>({ attack: 0.012, decay: 0.3, sustain: 0.55, release: 0.8 });
  const [filt, setFilt] = useState<FilterValue>({ cutoff: 1800, resonance: 0.3 });
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
      <div className="sheet-col"><span className="sheet-note">Filter, lowpass, with the envelope opening it (thin muted curve)</span>
        <FilterGraph value={filt} reset={{ cutoff: 1800, resonance: 0.2 }} min={80} max={12000} envAmount={0.35} onChange={setFilt} /></div>
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

function Card({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return <section className="sheet-card" data-wide={wide || undefined}><h2>{title}</h2>{children}</section>;
}

export function Sheet() {
  const [name, setName] = useState('Kestrel P2 build');
  const [width, setWidth] = useState('1280');
  const [tone, setTone] = useState<'plain' | 'warm' | 'formal'>('warm');
  const [grid, setGrid] = useState<'1/8' | '1/16' | '1/32'>('1/16');
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

        <Card title="Two-axis pad" wide>
          <Pads />
        </Card>

        <Card title="Instrument controls (Music's Device panel and drum kit)" wide>
          <Instruments />
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

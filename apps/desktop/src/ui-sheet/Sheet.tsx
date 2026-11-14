import { useState, type ReactNode } from 'react';
import { dayLabel, timeLabel } from '../dates';
import {
  Avatar, Button, Checkbox, Chip, Count, Dot, IconButton, ListRow, Meter, ParamCell, ParamGrid, Progress, Segmented, Select,
  Slider, StatusLetter, StatusText, Switch, TextField, CONTENT_COLORS,
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
const CAL = 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4';

function Card({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return <section className="sheet-card" data-wide={wide || undefined}><h2>{title}</h2>{children}</section>;
}

export function Sheet() {
  const [name, setName] = useState('Kestrel P2 build');
  const [width, setWidth] = useState('1280');
  const [tone, setTone] = useState<'plain' | 'warm' | 'formal'>('warm');
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

import { RowMark } from './RowMark';
import { FromMobius } from './FromMobius';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { lineDiff } from './code-view';
import { parseSkill, writeSkill, type Skill } from './skill-format';
import { useFileReview } from './useFileReview';
import type { SkillsState } from './useSkills';
import { ReviewActions, WhyThis } from './ReviewBar';

/** The skills Mobius keeps, by name, with New skill. */
export function SkillsSidebar({ skills, pin, changed, places }: { skills: SkillsState; pin?: ReactNode; changed?: ReadonlySet<string>; /** Extensions' places, above the skills. */ places?: ReactNode }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await skills.create(name.trim() || 'New skill', about)) { setNaming(false); setName(''); setAbout(''); } };
  const picker = useRef<HTMLInputElement>(null);
  const [shared, setShared] = useState<string | null>(null);
  return (
    <aside className="side skills-side" aria-label="Skills sidebar">
      <div className="side-head">
        <span className="side-title">{places ? 'Extensions' : 'Skills'}</span>
        <span className="side-actions">
          {pin}
          <button type="button" className="strip-btn" aria-label="New skill" title="New skill" onClick={() => setNaming(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
        </span>
      </div>
      {places}
      {naming && (
        <form className="skill-new" onSubmit={(e) => void submit(e)}>
          <input autoFocus aria-label="Skill name" placeholder="Compare stays" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false); }} />
          <input aria-label="When to use it" placeholder="When to use it, in one sentence" value={about} maxLength={300} onChange={(e) => setAbout(e.target.value)} />
          <button type="submit" className="btn primary">Create</button>
        </form>
      )}
      {skills.list.length === 0 && !naming && (
        <div className="side-empty notes-empty">
          <p>A skill is a procedure Mobius follows when a task comes back: the steps in plain words, kept as SKILL.md in your workspace.</p>
          <button type="button" className="btn primary" onClick={() => setNaming(true)}>New skill</button>
        </div>
      )}
      <div className="skill-install-row">
        <button type="button" className="btn" onClick={() => picker.current?.click()}>Install a skill…</button>
        <input ref={picker} type="file" accept=".md,text/markdown,text/plain" hidden aria-label="Choose a SKILL.md" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.text().then(setShared); }} />
      </div>
      {shared !== null && <InstallDialog text={shared} skills={skills} onClose={() => setShared(null)} />}
      <nav className="task-lists" aria-label="Skills">
        <ul role="list">
          {skills.list.map((s) => (
            <li key={s.name}>
              <button type="button" className="list-row skill-row" aria-current={skills.open?.name === s.name ? 'page' : undefined} onClick={() => void skills.openSkill(s.name)}>
                <span className="list-name">/{s.name}</span>
                <RowMark changed={changed?.has(s.name) === true} changedTitle="Changed by Mobius in its last turn" />
                <span className="list-count">v{s.version}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <FromMobius items={skills.list.filter((s) => changed?.has(s.name)).map((s) => ({ key: s.name, name: `/${s.name}`, current: skills.open?.name === s.name, onOpen: () => void skills.openSkill(s.name) }))} />
    </aside>
  );
}

/**
 * A skill someone shared, before it is added: what it is for, its steps, and what it says it will use. Nothing in it
 * runs until Mobius is asked for it, and each tool still asks as your settings say.
 */
export function InstallDialog({ text, skills, onClose }: { text: string; skills: SkillsState; onClose: () => void }) {
  const skill = parseSkill(text);
  const tools = skill.extra.find((l) => /^allowed-tools:/.test(l))?.replace(/^allowed-tools:\s*/, '').split(/[\s,]+/).filter(Boolean) ?? [];
  const valid = text.startsWith('---') && skill.name !== '' && skill.description !== '';
  const [problem, setProblem] = useState<string | null>(null);
  const install = async () => {
    const made = await window.mobius.skills?.install(text);
    if (!made || 'ok' in made) { setProblem(made && 'message' in made ? made.message : 'That skill could not be added.'); return; }
    await skills.openSkill(made.name);
    onClose();
  };
  return createPortal(
    <div className="cal-modal-layer skill-install-layer" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="camera-dialog" role="dialog" aria-modal="true" aria-label="Install a skill">
        <h2>{valid ? `Install /${skill.name}?` : 'This is not a skill'}</h2>
        {valid ? (
          <>
            <p className="camera-note">{skill.description}</p>
            <div className="skill-field"><span>Steps</span><ol className="skill-install-steps">{skill.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
            <div className="skill-field" role="group" aria-label="What it can touch">
              <span>What it can touch</span>
              {tools.length > 0 ? <ul className="skill-install-tools">{tools.map((t) => <li key={t}><code>{t}</code></li>)}</ul> : <p className="camera-note">It does not say. Mobius can use only what your settings allow, and asks first where they say so.</p>}
            </div>
            <p className="camera-note">Nothing runs when you install it: Mobius follows it only when asked, and every tool still goes through your approvals.</p>
          </>
        ) : <p className="camera-note">A SKILL.md starts with its name and when it runs, between lines of ---, then its steps.</p>}
        {problem && <p className="tasks-message" role="alert">{problem}</p>}
        <div className="camera-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {valid && <button type="button" className="btn primary" onClick={() => void install()}>Install</button>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One skill: when it is used, its steps to edit one by one, its versions, and Run. */
export function SkillEditor({ skills, review, onRun }: { skills: SkillsState; review?: { conversation: string } | null; onRun: (name: string) => void }) {
  const skill = useMemo(() => parseSkill(skills.text), [skills.text]);
  const file = skills.open ? `skills/${skills.open.name}/SKILL.md` : null;
  const { before, keep, discard } = useFileReview(review, file, skills.open?.modified);
  const rows = useMemo(() => (before !== undefined ? lineDiff(before ?? '', skills.text) : null), [before, skills.text]);
  const changedRows = rows?.filter((r) => r.kind !== 'same') ?? [];
  const set = (fn: (s: Skill) => void) => { const next = structuredClone(skill); fn(next); skills.edit(writeSkill(next)); };
  if (!skills.available) return <section className="skills-page empty" aria-label="Skills"><p className="note-empty">Skills are not available here.</p></section>;
  if (!skills.open) return <section className="skills-page empty" aria-label="Skills"><p className="note-empty">Make a skill on the left: a task you do again and again, in plain steps.</p></section>;
  const name = skills.open.name;
  return (
    <section className="skills-page" aria-label="Skills">
      <header className="skill-head">
        <h2>/{name}</h2>
        <span className="photo-meta">{`Version ${skills.open.version}${skills.saved ? '' : ' · Saving…'}`}</span>
        <span className="code-head-actions">
          <button type="button" className="btn" onClick={() => void skills.remove()}>Delete</button>
          <button type="button" className="btn primary" onClick={() => onRun(name)}>Run</button>
        </span>
      </header>
      {skills.message && <p className="tasks-message" role="alert">{skills.message}</p>}
      {changedRows.length > 0 && (
        <div className="skill-review" role="group" aria-label="Mobius's change">
          <div className="skill-review-head">
            <span className="review-dot" aria-hidden="true" />
            <span>Mobius changed this skill{review && <WhyThis conversation={review.conversation} />}</span>
            <ReviewActions onKeep={keep} onDiscard={() => discard().then(() => skills.reload())} />
          </div>
          <ul className="skill-review-lines">
            {changedRows.map((r, i) => <li key={i} data-kind={r.kind}>{r.kind === 'add' ? '+ ' : '− '}{r.text}</li>)}
          </ul>
        </div>
      )}
      <label className="skill-field">
        <span>Runs when</span>
        <textarea aria-label="Runs when" rows={2} value={skill.description} maxLength={500} onChange={(e) => set((s) => { s.description = e.target.value; })} />
      </label>
      <div className="skill-field">
        <span>Steps</span>
        <ol className="skill-steps" aria-label="Steps">
          {skill.steps.map((step, i) => (
            <li key={i} className="skill-step">
              <span className="skill-step-n" aria-hidden="true">{i + 1}</span>
              <input aria-label={`Step ${i + 1}`} value={step} maxLength={500} onChange={(e) => set((s) => { s.steps[i] = e.target.value; })} />
              <button type="button" className="strip-btn" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => set((s) => { [s.steps[i - 1], s.steps[i]] = [s.steps[i]!, s.steps[i - 1]!]; })}>↑</button>
              <button type="button" className="strip-btn" aria-label={`Remove step ${i + 1}`} onClick={() => set((s) => { s.steps.splice(i, 1); })}>×</button>
            </li>
          ))}
        </ol>
        <button type="button" className="btn" onClick={() => set((s) => { s.steps.push(''); })}>Add a step</button>
      </div>
      <label className="skill-field">
        <span>Notes</span>
        <textarea aria-label="Notes" rows={3} value={skill.notes} maxLength={20000} placeholder="Anything else Mobius should know when it follows this skill" onChange={(e) => set((s) => { s.notes = e.target.value; })} />
      </label>
      <section className="skill-versions" aria-label="Versions">
        <div className="design-panel-title">Every version Mobius or you made</div>
        {skills.open.versions.length === 0 ? <p className="design-hint">Earlier versions appear here as the skill changes.</p> : (
          <ul role="list">
            {[...skills.open.versions].reverse().map((v) => (
              <li key={v.version} className="skill-version">
                <span>v{v.version}</span>
                <span className="photo-meta">{new Date(v.modified).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <button type="button" className="btn" aria-label={`Restore version ${v.version}`} onClick={() => void skills.restore(v.version)}>Restore</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

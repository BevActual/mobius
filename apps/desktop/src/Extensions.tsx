import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AboutInfo, ConnectorStatus } from '@mobius/shared';
import { InstallDialog, SkillsSidebar } from './Skills';
import type { SkillsState } from './useSkills';
import { OtherApps } from './settings/sections';
import { APP_GROUPS, APPS, CORE_APPS, isInstalled, withApp, type AppId } from './apps';
import { APP_ICONS } from './Rail';
import { usePreferences } from './usePreferences';

/** The places in Abilities: the apps you add, and what gives Mobius more to work with, in one app. */
export type ExtensionPlace = 'apps' | 'connectors' | 'skills' | 'plugins' | 'catalogue' | 'updates';
export const EXTENSION_PLACES: readonly { id: ExtensionPlace; name: string }[] = [
  { id: 'apps', name: 'Apps' },
  { id: 'connectors', name: 'Connectors' },
  { id: 'skills', name: 'Skills' },
  { id: 'plugins', name: 'Plugins' },
  { id: 'catalogue', name: 'Catalogue' },
  { id: 'updates', name: 'Updates' },
];

function Places({ place, onPlace }: { place: ExtensionPlace; onPlace: (p: ExtensionPlace) => void }) {
  return (
    <nav className="task-lists ext-places" aria-label="Abilities">
      <ul role="list">
        {EXTENSION_PLACES.map((p) => (
          <li key={p.id}>
            <button type="button" className="list-row" aria-current={place === p.id ? 'page' : undefined} onClick={() => onPlace(p.id)}>
              <span className="list-name">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Extensions' sidebar: its places, and under Skills the skills themselves. */
export function ExtensionsSidebar({ place, onPlace, skills, pin, changed }: { place: ExtensionPlace; onPlace: (p: ExtensionPlace) => void; skills: SkillsState; pin?: ReactNode; changed?: ReadonlySet<string> }) {
  const places = <Places place={place} onPlace={onPlace} />;
  if (place === 'skills') return <SkillsSidebar skills={skills} pin={pin} changed={changed} places={places} />;
  return (
    <aside className="side skills-side" aria-label="Abilities sidebar">
      <div className="side-head">
        <span className="side-title">Abilities</span>
        <span className="side-actions">{pin}</span>
      </div>
      {places}
    </aside>
  );
}

/** Extensions' page for every place but Skills (which has its own editor). */
export function ExtensionsPage({ place, skills, onPlace }: { place: Exclude<ExtensionPlace, 'skills'>; skills: SkillsState; onPlace: (p: ExtensionPlace) => void }) {
  const name = EXTENSION_PLACES.find((p) => p.id === place)?.name ?? 'Abilities';
  return (
    <section className="skills-page ext-page" aria-label={name}>
      <h1 className="ext-title">{name}</h1>
      {place === 'apps' && <AppLibrary />}
      {place === 'connectors' && <Connectors />}
      {place === 'plugins' && <p className="note-empty">No plugins are installed.</p>}
      {place === 'catalogue' && <Catalogue skills={skills} onPlace={onPlace} />}
      {place === 'updates' && <Updates />}
    </section>
  );
}

/**
 * The app library: every app Mobius has, by what it is for. Adding one puts it in the switcher, the launcher and the
 * sidebar; removing it takes it away and keeps its files, so adding it again brings them back.
 */
function AppLibrary() {
  const preferences = usePreferences();
  const [problem, setProblem] = useState<string | null>(null);
  const change = async (id: AppId, add: boolean) => {
    setProblem(null);
    try { await preferences.set({ installedApps: withApp(id, add) }); } catch { setProblem('That could not be changed.'); }
  };
  const groups = APP_GROUPS.map((group) => ({ group, members: APPS.filter((a) => a.group === group && a.available && !(CORE_APPS as readonly string[]).includes(a.id)) })).filter((g) => g.members.length > 0);
  return (
    <div className="ability-apps">
      <p className="ext-lede">Add the apps you use. Removing one keeps its files: add it again and they are back.</p>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      {groups.map(({ group, members }) => (
        <section key={group} className="ability-group" aria-label={group}>
          <h2 className="ability-group-title">{group}</h2>
          <ul role="list" className="ability-list">
            {members.map((app) => {
              const added = isInstalled(app.id);
              return (
                <li key={app.id} className="ability-row">
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="ability-icon" style={{ background: `var(--app-${app.id})` }}>{APP_ICONS[app.id]}</svg>
                  <span className="ability-name">{app.name}</span>
                  {added && <span className="ability-state">Added</span>}
                  <button type="button" className={added ? 'btn' : 'btn primary'} aria-label={`${added ? 'Remove' : 'Add'} ${app.name}`} onClick={() => void change(app.id, !added)}>{added ? 'Remove' : 'Add'}</button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The MCP servers Mobius starts from mcp.json, and Mobius offered to other apps. */
function Connectors() {
  const api = window.mobius.extensions;
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const load = useCallback(() => { void api?.connectors().then(setStatus).catch(() => undefined); }, [api]);
  useEffect(load, [load]);
  // Servers start in the background: look again once they have had a moment.
  useEffect(() => { const t = window.setTimeout(load, 3000); return () => window.clearTimeout(t); }, [load]);
  const none = status && status.running.length === 0 && status.failed.length === 0;
  return (
    <>
      <section className="ext-block" aria-label="Tools from other apps">
        <h2 className="ext-heading">Tools from other apps</h2>
        {!api && <p className="note-empty">Only the desktop app runs connectors.</p>}
        {status?.problem && <p className="field-error" role="alert">{status.problem}</p>}
        {none && <p className="note-empty">No connectors yet. MCP servers listed in mcp.json in the data folder start when Mobius opens, and their tools ask as your settings say.</p>}
        {status && (status.running.length > 0 || status.failed.length > 0) && (
          <ul className="clist" role="list" aria-label="Connectors">
            {status.running.map((s) => (
              <li key={s} className="clist-item ext-row" aria-label={s}><span className="ext-name">{s}</span><span className="ext-state">Connected</span></li>
            ))}
            {status.failed.map((f) => (
              <li key={f.server} className="clist-item ext-row" aria-label={f.server}><span className="ext-name">{f.server}</span><span className="ext-state field-error">{f.error}</span></li>
            ))}
          </ul>
        )}
        {api && <p><button type="button" className="btn" onClick={() => void window.mobius.app.openDataFolder()}>Open data folder</button></p>}
      </section>
      <section className="ext-block" aria-label="Mobius for other apps">
        <h2 className="ext-heading">Mobius for other apps</h2>
        <OtherApps subpage="other-apps" highlight={null} />
      </section>
    </>
  );
}

/** What can be added, and how. */
function Catalogue({ skills, onPlace }: { skills: SkillsState; onPlace: (p: ExtensionPlace) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [shared, setShared] = useState<string | null>(null);
  return (
    <ul className="clist" role="list" aria-label="Catalogue">
      <li className="clist-item ext-row">
        <span className="ext-name">A skill from a file</span>
        <span className="ext-state">A SKILL.md someone shared. Nothing in it runs until you ask for it.</span>
        <button type="button" className="btn" onClick={() => picker.current?.click()}>Install a skill…</button>
        <input ref={picker} type="file" accept=".md,text/markdown,text/plain" hidden aria-label="Choose a SKILL.md" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.text().then(setShared); }} />
        {shared !== null && <InstallDialog text={shared} skills={skills} onClose={() => { setShared(null); if (skills.open) onPlace('skills'); }} />}
      </li>
      <li className="clist-item ext-row">
        <span className="ext-name">A connector</span>
        <span className="ext-state">An MCP server, added to mcp.json in the data folder.</span>
        <button type="button" className="btn" onClick={() => onPlace('connectors')}>Connectors</button>
      </li>
    </ul>
  );
}

/** What is installed, from About. */
function Updates() {
  const [about, setAbout] = useState<AboutInfo | null>(null);
  useEffect(() => { void window.mobius.app.about().then(setAbout).catch(() => undefined); }, []);
  return (
    <table className="stable" aria-label="Versions">
      <tbody>
        <tr><th scope="row">Mobius</th><td>{about?.app ?? '…'}</td></tr>
        <tr><th scope="row">Core</th><td>{about?.core ? `${about.core.version} (protocol ${about.core.protocol})` : 'Not running'}</td></tr>
      </tbody>
    </table>
  );
}

import { useCallback, useEffect, useState } from 'react';

/** "https://axion.example" → "axion.example". */
export const siteName = (site: string) => site.replace(/^https?:\/\//, '');

/**
 * Sign in once per task, in the conversation. When a page Mobius drives asks for a sign-in on a site this task has none
 * for, it shows "Needs you: sign in to … for this task" with Sign in and Not now: Sign in shows the page for the person to
 * sign in themselves (their password manager fills it; Mobius never sees the password), then Done records the sign-in
 * for this task and lets Mobius carry on. While it lasts, a line says so, with Sign out now.
 */
export function SignInForTask({ conversation, onShowPage, onSay }: { conversation: string; onShowPage: (tab: string) => void; onSay: (text: string) => void }) {
  const api = window.mobius.signins;
  const [needed, setNeeded] = useState<{ site: string; tab: string } | null>(null);
  const [signing, setSigning] = useState(false);
  const [sites, setSites] = useState<string[]>([]);
  const load = useCallback(async () => {
    const r = await api?.list(conversation).catch(() => null);
    setSites(r && r.ok ? r.sites : []);
  }, [api, conversation]);
  useEffect(() => { setNeeded(null); setSigning(false); void load(); }, [conversation, load]);
  useEffect(() => {
    if (!api) return undefined;
    const offNeeded = api.onNeeded((n) => { if (n.conversation === conversation) { setNeeded({ site: n.site, tab: n.tab }); setSigning(false); } });
    const offChanged = api.onChanged((c) => { if (c.conversation === conversation) void load(); });
    return () => { offNeeded(); offChanged(); };
  }, [api, conversation, load]);
  if (!api) return null;
  const done = async () => {
    if (!needed) return;
    await api.signedIn(conversation, needed.site).catch(() => null);
    onSay(`I signed in to ${siteName(needed.site)}. Carry on.`);
    setNeeded(null);
  };
  const notNow = () => {
    if (!needed) return;
    onSay(`Not now: do not sign in to ${siteName(needed.site)}. Do what you can without it.`);
    setNeeded(null);
  };
  return (
    <>
      {needed && (
        <div className="approval signin-card" role="group" aria-label={`Sign in to ${siteName(needed.site)}`}>
          <p className="approval-head">Needs you</p>
          <p className="approval-text">Sign in to <b>{siteName(needed.site)}</b> for this task. You sign in yourself, in the page; your password manager can fill it. Mobius never sees the password.</p>
          <div className="approval-actions">
            {signing ? (
              <button type="button" className="btn primary" onClick={() => void done()}>Done, I signed in</button>
            ) : (
              <button type="button" className="btn primary" onClick={() => { setSigning(true); onShowPage(needed.tab); }}>Sign in</button>
            )}
            <button type="button" className="btn" onClick={notNow}>Not now</button>
          </div>
        </div>
      )}
      {sites.map((site) => (
        <p key={site} className="signin-line" role="status">
          <span>Signed in to {siteName(site)} for this task · ends when the task ends</span>
          <button type="button" className="review-btn" onClick={() => void api.signOut(conversation, site)}>Sign out now</button>
        </p>
      ))}
    </>
  );
}

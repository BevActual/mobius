# Writing the docs

This is the skeleton every Mobius doc follows: where a page goes, what shape it takes, how it is named, how
screenshots stay current, and how the docs keep up with the app. Read it before adding or moving a page.

## The rule that keeps docs true

**A pull request that changes what a person sees or does also updates the docs.** That means the matching page in
`docs/apps/` or `docs/guide/`, and any screenshot that no longer matches. Reviewers check this before merging, and the
pull request template has a box for it.

**These pages are also the app's Learn view** (Help › Learn Mobius). Each page in `docs/getting-started/` and
`docs/guide/` is a lesson, and each `## App` section of a `docs/apps/` page is that app's lesson: its first sentence is
the lesson's card, and the bold lead-ins of its list (`- **Smart lists**: …`) are the lesson's "What you can do". So:

- Start every page and app section with one sentence that says what it is for.
- Name each thing an app can do as a bold lead-in on a list item, so it shows as a capability.
- Name an app's section exactly as the app is named in the app (Knowledge, Music, Abilities), or Learn cannot match it.
- Pictures are left out in Learn (the app is beside it), tables become lists, and links between pages read as words.

`apps/desktop/src/learn.test.ts` reads the real pages and **fails** when an app in the app list has no section, so a new or
renamed app adds its `## <App name>` section in the same pull request.

## Where a page goes

The docs have one home, [`docs/README.md`](README.md), and five sections. Every new page is linked from the home page or
from its section's index; a page nothing links to doesn't exist for readers.

| Section | Folder | Holds | Reader |
| --- | --- | --- | --- |
| Getting started | `getting-started/` | Install, first run, the tour. Kept short: a new person reads all of it. | New users |
| User guide | `guide/` | Things that work across apps: modes and review, Abilities, models, voice, memory, privacy, settings, shortcuts. One subject per page. | Users |
| Apps | `apps/` | One page per app-hub group, one section per app. | Users |
| Developers | `developers/` | Setup, architecture, testing, releasing, tools for working on Mobius. | Contributors |
| Decisions | `adr/` | Architecture decision records, numbered, never rewritten. | Contributors |

Outside the sections:

| Path | Holds |
| --- | --- |
| `roadmap.md` | Plans. The only page that talks about the future. |
| `glossary.md` | Mobius's own words, defined once. |
| `troubleshooting.md` | Problems people hit, and what to do. |
| `design/` | Design rules the interface follows. |
| `reference/` | Working notes and research (Hermes comparisons, provider requirements). Not user docs. |
| `templates/` | Starting points for new pages. |
| `readme/` | Images used by the README and the docs (see [Screenshots](#screenshots)). |
| `CODE_SIGNING_POLICY.md` | What is signed and how; keep its path. |

Repository-level files stay at the root where GitHub looks for them: `README.md`, `CONTRIBUTING.md`, `SECURITY.md`,
`CODE_OF_CONDUCT.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`.

### Deciding where something goes

- It's about **one app** → that app's section in `apps/`.
- It works **across apps** or lives in Settings → a page in `guide/`. Settings sections map to pages in
  [Settings](guide/settings.md).
- It's for **people changing the code** → `developers/`.
- It's a **choice that's hard to reverse** → a new ADR.
- It's **not built yet** → `roadmap.md`, nowhere else.
- It's **research or notes** → `reference/`.

A new app gets a section in its group's page, a row in [`apps/README.md`](apps/README.md), and a screenshot. A group's
page splits into one page per app only when the group page passes about 300 lines.

## Page shape

Every page starts with a `#` title and one or two sentences that say what the page is for. Then:

- **Guide page:** [`templates/guide-page.md`](templates/guide-page.md). What it is, how to use it, the settings, related
  pages.
- **App section:** [`templates/app-section.md`](templates/app-section.md). One line on what it's for, a screenshot, what
  you can do, Mobius in the app, where its files are kept, its settings.
- **Decision record:** [`templates/adr.md`](templates/adr.md).

Headings are sentence case. Keep to `##` and `###`; deeper headings mean the page should be split.

## Naming

- **Files and folders:** lowercase with hyphens (`models-and-gateways.md`). Name a page for its subject, not a verb.
- **Folder index:** `README.md`, so GitHub shows it when the folder opens.
- **ADRs:** `adr/NNNN-short-title.md`, numbered after the last one.
- **Things in the app:** the names people see, in bold the first time on a page: **Music** (not Studio), **Knowledge**
  (not Wiki), **Abilities** (not Extensions), **Agents** (not Bots), **Gateways** (not Providers). Code names appear only
  in `developers/` and `adr/`, in `code` style.
- **Menu paths:** with `›`, in bold: **Settings › Models › Defaults**.
- **Keys:** as written on a Windows keyboard: Ctrl+K, Shift+Tab, Esc.

## Style

- Plain words and full sentences. Say what something does, then how to use it.
- Present tense, about the app as it is now. "Mobius asks before…", not "Mobius will ask…".
- Talk to the reader as "you"; the agent is "Mobius".
- Short paragraphs. Tables for comparisons and lists of settings or commands; bullets for lists of things.
- Link instead of repeating. Each fact lives on one page; others link to it.
- Use relative links (`../guide/abilities.md#skills`), so they work on GitHub and in a clone.
- No marketing, no emoji, and never the ✦ sparkle.

## Screenshots

- **One picture per app**, shared by the README and the docs: `docs/readme/apps/<app>.png`, named by the app's visible
  name in lowercase (`music.png`, `knowledge.png`). Other docs images go in `docs/readme/` with a name for what they
  show.
- Take them from the real app, not a mock-up: `npm run dev` (the preview with sample data) or the app itself, at 1440×900
  and 2× scale, in light mode. Add a `-dark` copy only where dark mode is the point.
- Show real-looking work (the sample data's Kestrel build at Northway Motors), never personal data.
- Every image has alt text that says what it shows.
- Retake a screenshot in the same pull request that changes what it shows. The Windows end-to-end run also captures
  every app in light and dark (`e2e/screens.spec.ts`, published on the `ci-screens/<branch>` branch), which is a quick
  way to see which pictures are out of date.

## Checking a docs change

- Every relative link and `#anchor` resolves. GitHub's preview of the pull request shows broken images and links.
- The page reads correctly against the app as it is on the branch.
- New pages are linked from the docs home or their section index.
- The lesson reads well in Learn: open Help › Learn Mobius on the branch and find it.

## Reviewing the docs as a whole

Every few releases, or when the app changes a lot, read the docs home and each section index and ask:

- **Add:** is there a feature, setting or app with no page?
- **Organize:** is any page longer than it should be, or a section that no longer fits its folder?
- **Update:** does any page or screenshot describe something that has changed?
- **Remove:** is anything duplicated, unused, or about something that no longer exists?

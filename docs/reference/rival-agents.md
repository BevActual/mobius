# Mobius: rival agents and target apps

> Copied from the claude.ai page of the same name on 14 November 2026, when the project moved to the repo. Links point at the repo copies.

Nov 10, 2026

Which apps Mobius should be measured against, which apps it needs as it grows, and what the leading agent products teach us about its design.

## Target apps

Go deep on three apps, Mail, Browser and Studio, and keep the rest on a light watch. Together they span the range Andrew named: Mail is simple and daily, Browser is where agents are most powerful and most dangerous, and Studio is the Ableton-class ceiling. If Mobius beats the best rival on these three, the patterns carry to every other app.

| Mobius app | Measure against | Why this rival | Depth |
| --- | --- | --- | --- |
| Mail | Superhuman, then Gmail with Gemini | Superhuman sets the bar for speed and keyboard flow; Gmail shows what a built-in assistant does by default | Deep |
| Browser | Arc / Dia and Safari 26 for browsing; ChatGPT Atlas and Perplexity Comet for the agent | People want a good plain browser first; Atlas and Comet are the agent-browser bar, and their security failures are the warning | Deep |
| Studio | Ableton Live 12 | The complexity ceiling: dense views, instant feedback, nothing the user did is ever lost | Deep |
| Code | Cursor, VS Code with Copilot, Claude Code | The most mature agent UX anywhere: diffs, checkpoints, plan mode, permission prompts | Watch (borrow its patterns) |
| Sheets | Excel with Copilot Agent Mode, Google Sheets | Excel's agent builds and checks multi-step models; a direct comparison for Why this per cell | Watch |
| Notes | Apple Notes, Notion | Apple for calm and speed, Notion for structure and AI blocks | Light |
| Docs | Google Docs, Word with Copilot | Suggestion mode and comments are the review model people already know | Light |
| Calendar | Notion Calendar, Fantastical | Fast capture and scheduling links | Light |
| Tasks | Things 3, Todoist | Calm lists and natural-language capture | Light |
| Design | Figma | Comments, frames and multiplayer | Light |
| Wiki | Notion, Confluence | Page trees and permissions | Light |
| Files | OneDrive / SharePoint, Dropbox | Sync, versions and sharing | Light |
| Home, chat and Bots | ChatGPT, Claude desktop and Cowork, Copilot app, Hermes Agent | The agent itself; studied in the next section | Covered below |

### What "deep" means for each

Each deep app gets five real jobs, timed side by side with its rival, scored on time to done, steps the person had to take, and whether they could see and undo what the agent did.

- **Mail vs Superhuman:** triage 40 unread to zero; reply to Ana with a drafted answer; find a quote from last month; schedule a send; turn a thread into a task. Mobius must match Superhuman's keyboard speed before Draft it counts.
- **Browser vs Arc/Dia and Atlas:** compare three supplier quotes across tabs; fill the Axion form with sign-in per task; download a datasheet through the gate; resist a planted prompt injection on a page; get back to yesterday's tab. The injection test is the one Atlas and Comet failed in public.
- **Studio vs Ableton:** sketch an 8-bar idea from a hum; add a part under a clip; undo three Mobius changes in a row; export stems; work 30 minutes with Mobius off. Ableton's bar is that the tool never gets in the way, so Studio must be fully usable with Mobius off.

## App roadmap

Mobius has enough apps for a first release. The next additions should be the places where people's work already happens but Mobius can't yet reach: messages, meetings and slides. One merge is decided: Artifacts becomes a view inside Files.

The test for any app: it holds things the person owns, Mobius can change them dashed in place, and one person works in it most days. An app that only shows Mobius's own output fails the test and becomes a view or a filter.

### Now: the first release

| App | What it does | Why Mobius makes it better |
| --- | --- | --- |
| Mail | Inbox, threads, compose | Draft it in your voice, triage overnight, sending always asks |
| Calendar | Day, week and month, events | Finds a time across people, prepares each meeting, moves never happen silently |
| Browser | Tabs, spaces, reader, downloads | Reads and drives tabs you can see, signs in per task, paying and downloads ask |
| Files | Drives, versions, sharing | Files what Mobius makes, dashed until Keep, and shows who read what |
| Notes | Quick capture | Pulls out decisions, rewrites in place, answers questions inside the note |
| Docs | Long writing | Edits show dashed like suggestions, with Why this |
| Sheets | Tables and models | Builds formulas with sources per cell, checks numbers against quotes |
| Tasks | Lists and to-dos | Turns mail, notes and meetings into to-dos with where they came from |
| Mobius apps: Bots, Activity, Projects, Views, Extensions, Settings | Run and govern Mobius itself | Bots with a contract, Rewind in Activity, shared memory per project |
| Pro apps: Studio, Design, Code, Wiki | Music, design, code and a company knowledge base | Show the ceiling: the same dashed changes and Rewind in a dense tool, and fully usable with Mobius off |

### Next: add as Mobius grows

| App | What it does | Why Mobius makes it better | Rival to beat |
| --- | --- | --- | --- |
| Messages | Slack, Teams, WhatsApp and SMS in one place | Hermes already connects 23 chat platforms, so this gives that gateway a home; drafts replies, never sends without asking | Beeper, Slack |
| Meetings | Calls, transcripts and notes | Notes become tasks, calendar follow-ups and mail drafts, all dashed; recording always asks | Granola, Teams |
| Slides | Decks | Builds a deck from a doc or sheet, keeps numbers linked to the source | Keynote, PowerPoint |
| People | Contacts and the history with each one | Mobius remembers who said what across mail, messages and meetings | Apple Contacts, Clay |

### Later: when the core is solid

| App | What it does | Why wait |
| --- | --- | --- |
| Photos and media | Library, edits | Large, and needs on-device models to feel fast |
| Wallet | Bills, receipts, budgets | Paying always asks; needs a trust story first |
| Phone and camera | Calls, scans | Already on the not-built list; depends on a mobile client |
| Terminal | Commands | Lives inside Code for now; running a command always asks |

### Merge or keep apart

| Pair | Recommendation | Why |
| --- | --- | --- |
| Artifacts and Files | Merge (Andrew decided, 10 Nov): Artifacts becomes a "Made by Mobius" view in Files | Both list files with a dashed state until Keep; two homes for one file confuses |
| Notes and Docs | Keep apart | Apple, Google and Microsoft all keep quick capture apart from long writing |
| Wiki and Docs | Keep apart for now | Wiki checks pages against the other apps; revisit if few people use it |
| Views and the home desk | Keep apart | The desk is today; a view is a saved dashboard you share |
| Design and Code | Keep as pro apps, opened from the switcher, not the dock | They are deep tools for some people, like Studio |

## Agents studied

Every leading agent now has the same three parts: a way to ask, a place it works out of your sight, and a gate before risky steps. They differ on where the work lands and how you take it back, and that is where Mobius can lead. Nobody studied here offers a real undo of what the agent changed, except coding tools.

| Agent | What it gets right | What goes wrong | Lesson for Mobius |
| --- | --- | --- | --- |
| [Hermes Agent](https://www.nxcode.io/resources/news/hermes-agent-complete-guide-self-improving-ai-2026) (Nous Research) | Writes its own skill after any task of five or more tool calls and patches it later; layered memory; one gateway to 23 chat platforms; Kanban of parallel agents with a worktree each; a "▶ N" count of background tasks | Self-learning is off by default and confuses people; learned skills do not transfer well; recalled memory had to be labelled "informational, not authoritative"; no undo | Offer "Make this a skill" after a long run, but show the skill and ask before saving it. Label what memory supplied. |
| Claude Code (product knowledge) | Permission modes cycled with Shift+Tab (ask, accept edits, plan); plan mode before acting; checkpoints you can rewind to; every edit shown as a diff | Long runs pile up prompts until people switch on auto-accept and stop reading | Mobius already has the modes. Keep Rewind first-class and group small asks so Propose never turns into prompt fatigue. |
| [Claude Cowork](https://www.clickforest.com/en/blog/claude-cowork-explained) | Manual and Auto modes; always asks before a permanent delete; each session in its own sandbox; every step shown; previews a folder plan or spreadsheet before doing it; scheduled tasks in the cloud | Uses limits fast; people outside tech are asked to watch for prompt injection themselves; no clear undo | Preview the whole plan as one dashed proposal (Propose). Never make the person the injection detector. |
| ChatGPT agent and [Atlas](https://help-lb.openai.com/en/articles/12591856-chatgpt-atlas-release-notes) | Asks before important actions; pause, interrupt or take over any time; a logged-out mode with no cookies; isolated clipboard; agent pages kept out of history; browser memories opt-in, per-site hide | Gave up on long repetitive jobs ("laziness" fixed Feb 2026); chat and agent mode were confused until Feb 2026; OpenAI says its guards "don't eliminate every risk" | Driven tabs need Take over and a logged-out start. Mobius's three tab states (yours, read, driven) already say who is in charge. |
| [Microsoft Copilot on Windows](https://blogs.windows.com/windowsexperience/2025/10/16/securing-ai-agents-on-windows/) | Off by default; agents run as a separate Windows account in their own agent workspace beside you; start with only Documents, Downloads, Desktop and Pictures; watch, take over or stop; [Copilot Tasks](https://windowsreport.com/microsoft-introduces-copilot-tasks-to-turn-ai-into-an-autonomous-digital-worker/) shows a plan and always asks before paying or sending | No undo or memory story; still experimental; cross-prompt injection admitted | Mobius on Windows should run Act work under the agent account and use [Microsoft's MCP registry](https://blogs.windows.com/windowsexperience/2025/05/19/securing-the-model-context-protocol-building-a-safer-agentic-future-on-windows/) (signed servers, declared privileges), as Andrew prefers. |
| [Perplexity Comet](https://www.theregister.com/2026/03/03/perplexity_comet_browser_hole_cal_invite/) | First-run choice of allow once, always or never; admins set which domains the agent may read or act on; does not upload tabs, cookies or passwords by default | A Hebrew calendar invite steered it into reading local files; the first fix was bypassed; it could reach an unlocked 1Password; its own detector scores about 0.91 F1 | Text Mobius reads is never an instruction. Per-site read and act rights, and no reach into passwords or files from a page. |
| [Manus](https://toolbrain-astro.pages.dev/blog/manus-review/) | Cloud computer keeps going after you close the laptop; a full replay of every site, command and step | About 1 in 10 complex tasks fail midway; no local files; no approval gates | Replay is Activity. Bots that run in the cloud must land results in your apps, not only in a transcript. |

## Lessons mapped to Mobius

Mobius's design already holds up well against the field: dashed changes in place with Keep / Discard / Try another, and Rewind, are things no rival has outside coding tools. The gaps are in taking over a running agent, injection defence, and where background work runs.

| Mobius piece | Adopt | Avoid |
| --- | --- | --- |
| Permission modes (Ask first / Propose / Act) | Cowork's "always asks before a permanent delete" and Copilot Tasks' "always asks before paying or sending" match Mobius's locked rules, so keep them locked in every mode. Comet's allow once / always / never fits Ask first per app. | Claude Code's prompt fatigue: in Propose, batch small asks into one card so people do not slide to Act just to stop the noise. |
| Keep / Discard / Try another | Cowork previews a folder plan or a sheet before acting: show a whole multi-step plan as one dashed proposal with a single Keep. | Transcript-only results (Manus, ChatGPT tasks): every result must land in an app, dashed. |
| Rewind | Claude Code checkpoints and Manus replay: Rewind to here in Activity, with a replay of each step (page, command, change). | Hermes and Cowork have no undo; that is Mobius's lead, so do not ship Act without Rewind. |
| Needs you | Atlas and Copilot let you pause, interrupt or take over any time: add Take over beside Stop on every working card, and in driven tabs. | Asking the person to spot prompt injection (Cowork's warning); Needs you is for decisions, not security. |
| Browser (driven tabs) | Atlas's logged-out start and isolated clipboard; Comet's per-site read and act rights; sign-in per task (already v168). Treat page text, mail and invites as data, never instructions. | Comet's reach into local files and an unlocked password manager from a page. |
| Bots | Hermes's "▶ N" running count in the sidebar; Copilot's plan shown before a scheduled run; cloud runs that continue with the laptop closed. | Bots with no contract: What it may touch (v104) stays required before a bot is saved. |
| Skills and memory | Hermes writes a skill after a long task: offer "Make this a skill" beside Make this a bot, shown before saving. Label anything memory supplied as "from memory". | Silent self-learning that changes behaviour without the person seeing it (Hermes Honcho confusion). |
| Windows runtime | Run Act work as Windows' separate agent account in the agent workspace; start with Documents, Downloads, Desktop and Pictures only; use Microsoft's MCP registry and Windows MCP support. | Community MCP servers for system access (Andrew's rule). |
| Per-app panel | Atlas's chat-vs-agent mix-up was fixed by clearer switching: the panel's mode chip must always show whether Mobius is talking or acting. | One chat that silently starts acting on the page. |

## Knowledge: two wikis, read by people and Mobius alike

**The goal, in Andrew's words:** give people and agents a place where they can store, look at and update knowledge, the way Wikipedia works. Everything below serves that one idea.

Mobius should have two kinds of wiki in the one Wiki app: an organization wiki and a personal one. People and Mobius read and write both, under the same rules. Today Mobius's memory is a hidden list. Making it a personal wiki makes it visible, editable and cited, which is what Hermes and ChatGPT memory lack.

|  | Organization wiki | Personal wiki |
| --- | --- | --- |
| Holds | Handbooks, decisions, how things are built, suppliers, glossary | How you work, your people and projects, preferences, things you've decided, your own how-tos |
| Who reads it | Everyone with access to the space, and Mobius in that project | You and your Mobius only, never shared unless you share a page |
| Who writes it | People, and Mobius as dashed fixes with sources until someone keeps them | You, and Mobius as dashed "I learned this" lines until you keep them |
| How Mobius uses it | Read first as trusted knowledge, then searches Files, Mail and the other apps (RAG) for the rest, citing both | Read at the start of every session in place of hidden memory; answers say "from your wiki" |
| Keeps it true | Checks pages against the other apps when a source changes (the v112 Wiki check) | Shows a line when something contradicts what you just did and asks to update it |
| Rival | Confluence, Notion, Microsoft 365 Copilot over SharePoint | ChatGPT memory, Hermes memory and skills, Obsidian |

Three rules carry over from the rest of Mobius. Search only covers what Mobius may read in the current app or project. Text found in a page is data, never an instruction. A skill Mobius writes after a long task becomes a personal wiki page you can read, edit or delete.

### Why company wikis fail, and what Mobius does about it

Andrew saw this at Amazon with server repair documentation: few people update or use the wiki, and teams doing the same job in different places each keep their own. Mobius can fix both because it sees the work as it happens.

| Problem | What Mobius does |
| --- | --- |
| Nobody updates it | The work writes the page. When a repair, ticket or task closes and the steps differ from the page, Mobius drafts the edit, dashed, and the person who did the work keeps it with one tap. |
| Nobody uses it | Mobius reads the wiki whenever anyone asks in any app, and cites the page. People use the wiki without opening it, and each page shows "used 34 times this month". Pages nobody uses are flagged to archive. |
| Teams keep duplicate wikis | Mobius finds pages that cover the same job across spaces (three "replace a power supply" runbooks from three teams) and proposes one shared page. Each team's differences stay as a labelled section, with why. The page owners approve the merge. |
| Nobody trusts it | Every page shows who verified it, when it was last checked against the work, and which sources agree. |

### How knowledge spreads

Knowledge moves up in steps, and each step is a Share that a person makes, never Mobius alone:

1. **Personal:** what you and your Mobius learned.
2. **Team:** shared with the people who do the same job.
3. **Organization:** one page for every team doing that job, with each team's differences inside.
4. **Between organizations:** a published pack, like a skill in the Extensions catalogue. Mobius strips names, customers and internal details before it leaves, and sending outside always asks.

### Who decides: the Wikipedia model (Andrew, 10 Nov)

A wiki has editors, not a single owner. Anyone can share a change to a page; the people with edit access to that wiki review it, like Wikipedia's pending changes.

- **Shared changes queue:** each wiki has a "Shared with this wiki" list of incoming edits from people, other teams and Mobius, each shown dashed on the page with who sent it, why and its sources. An editor keeps, edits or declines it.
- **Watch a page:** editors follow the pages they care about and get the queue for those pages only, so review stays small.
- **Talk beside the page:** a disagreement is a comment thread on the change (the v103 comments), not an edit war.
- **History and Restore:** every kept change is in the page's history, so a bad one is undone in one step.
- **Mobius as a helper, not an editor:** it drafts changes, spots duplicates and checks sources, but only a person with edit access keeps a change.

A "team" here is any group with its own space doing the same job: a location, a region, a separate team, or another company once pages are shared outside. For a merged page, each team's editors review changes to their own section, and editors of the shared parts review those.

### Facts and practices (Andrew, 10 Nov)

Every page holds two kinds of content, and Mobius treats them differently.

|  | Facts | Practices |
| --- | --- | --- |
| What | True regardless of opinion: physics, maths, specs, torque values, how a part fits together | The way a team does something, where two ways can both be right |
| On the page | One version, with its source (datasheet, standard, measurement) | A shared default, plus a labelled section per team that differs, saying how and why |
| Changing it | Needs a source; editors see the old and new value side by side | Any team can add or change its own section; the default changes by agreement |
| What Mobius does | Flags any page, note or reply that contradicts a fact, and links the source | Suggests a team section when it sees work done another way, and asks why |

If a team's practice contradicts a fact (a torque value above the spec), Mobius flags it as a problem rather than a variant.

## What to do next

Seven steps, in order. The first three are design work for the canvas, the next three go to the build thread, and the last is the comparison itself. None has been made yet.

- [ ] Add Take over beside Stop on every working card and on driven tabs (canvas).
- [ ] Show a multi-step Act or Propose run as one dashed plan with one Keep before it starts (canvas).
- [ ] Add "Make this a skill" beside Make this a bot, shown before saving, and a "from memory" label on answers (canvas).
- [ ] Add a replay of each step to Rewind to here in Activity (build, already next on the device).
- [ ] Treat page, mail and invite text as data in the core, and test it with a planted injection page in Browser (build).
- [ ] On Windows, run Act work under the agent account and connect tools through Microsoft's MCP registry (build).
- [ ] Run the five-job comparisons for Mail, Browser and Studio against their rivals once those apps run natively.

**On the canvas since v170 (10 Nov):** Mail's Get to zero plan and Ask your mail in the Mobius card, Send later at the time Priya reads, and keyboard keys; Wiki's Your wiki page with "Mobius learned this" lines and the Shared with this wiki review queue. Since v171, Projects is a place: Waiting on you, rules per app for each project, memory as a Wiki page, and a chat where bots report back as threads. Injection defence and Take over went to the build.

Open question: should Bots run in the cloud with the laptop closed, like Cowork and Manus, or stay on the PC? Cloud runs need a server Mobius does not have yet.

## Sources

Pages opened for this doc on 10 Nov 2026. Several are third-party reviews; funding and usage figures are company claims. The Atlas agent-mode help page could not be loaded, so Atlas facts come from its release notes. Claude Code entries are from product knowledge, not a fetched page.

- [Hermes Agent complete guide (nxcode, Apr 2026)](https://www.nxcode.io/resources/news/hermes-agent-complete-guide-self-improving-ai-2026)
- [Hermes Agent v0.15.0 release notes (May 2026)](https://newreleases.io/project/github/NousResearch/hermes-agent/release/v2026.5.28)
- [Nous Research Series B report (wwwhatsnew, Oct 2026)](https://wwwhatsnew.com/2026/10/08/nous-research-90-millones-hermes-agent-empresas-valoracion-1500-millones/)
- [ChatGPT Atlas release notes](https://help-lb.openai.com/en/articles/12591856-chatgpt-atlas-release-notes)
- [Comet calendar-invite flaw (The Register, Mar 2026)](https://www.theregister.com/2026/03/03/perplexity_comet_browser_hole_cal_invite/)
- [Perplexity Comet review 2026](https://perplexityaimagazine.com/perplexity-hub/perplexity-comet-review-2026/)
- [Securing AI agents on Windows (Microsoft, Oct 2025)](https://blogs.windows.com/windowsexperience/2025/10/16/securing-ai-agents-on-windows/)
- [Securing MCP on Windows (Microsoft, May 2025)](https://blogs.windows.com/windowsexperience/2025/05/19/securing-the-model-context-protocol-building-a-safer-agentic-future-on-windows/)
- [Agent Workspace (heise)](https://heise.de/-11084862)
- [Copilot on Windows works with local files (Neowin)](https://www.neowin.net/amp/copilot-on-windows-can-now-work-with-your-local-files-while-you-do-something-else/)
- [Copilot Tasks (Windows Report)](https://windowsreport.com/microsoft-introduces-copilot-tasks-to-turn-ai-into-an-autonomous-digital-worker/)
- [Claude Cowork explained (ClickForest, Oct 2026)](https://www.clickforest.com/en/blog/claude-cowork-explained)
- [Claude Cowork review (Hack'celeration)](https://hackceleration.com/claude-cowork-review/)
- [Manus review (ToolBrain, May 2026)](https://toolbrain-astro.pages.dev/blog/manus-review/)
- [Manus review (aiagentrank, May 2026)](https://aiagentrank.io/blog/manus-ai-review-2026)

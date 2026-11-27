# Shaping Mobius: what is an app, what is a feature, and where RAG and agents fit

Andrew asked on 27 November 2026 how RAG and agent factories would fit into Mobius, what others are doing, whether the
Agents app should shift, and, across all the apps, "what needs to be an app and what's a feature that apps can use".
This page is the plan to decide from. Removing, merging or adding apps stays his call; nothing here is built until he
says so, except where it is marked as ordinary shell work.

## What others do (from their own pages, read 27 November 2026)

**Grounding the assistant in your own things (RAG)**

- **Microsoft 365 Copilot** keeps a lexical and semantic (vector) index of the person's mail, files and chats. It is
  in the cloud, in the tenant's region, and only shows what the person can already open. It cannot be turned off;
  admins can leave sites out. ([Semantic index for Copilot](https://learn.microsoft.com/en-us/microsoftsearch/semantic-index-for-copilot))
- **Apple Intelligence**: apps describe their things as App Entities and their actions as App Intents. Entities go
  into the Spotlight semantic index with "attribution back to your app", so the system assistant finds and acts on an
  app's things without the app owning any AI.
  ([Apple Intelligence and Siri](https://developer.apple.com/documentation/appintents/apple-intelligence-and-siri-ai.md),
  [WWDC26 guide](https://developer.apple.com/wwdc26/guides/apple-intelligence/))
- **Obsidian Smart Connections** makes embeddings of the notes on the machine with a built-in local model, no key and
  offline, and shows related notes with a score. It finds; it does not answer.
  ([README](https://cdn.jsdelivr.net/gh/brianpetro/obsidian-smart-connections@main/README.md))

**Agent factories**

- **Notion Custom Agents** (February 2026): instructions, triggers (a schedule, a page added to a database, a
  comment, a Slack message), "Tools and access" (only the pages, databases and apps you grant), and a model. They run
  in the background and live in an Agents section of the sidebar, and can be put in a page.
  ([What are Custom Agents?](https://www.notion.com/help/custom-agents),
  [Introducing Custom Agents](https://www.notion.com/blog/introducing-custom-agents))
- **OpenAI AgentKit** (October 2025) had Agent Builder, a visual canvas of nodes (agent, file search, guardrails, MCP,
  user approval). A note at the top of the page, dated 3 June 2026, says Agent Builder ends on 30 November 2026, in
  favour of the Agents SDK for developers and workspace agents inside ChatGPT.
  ([Introducing AgentKit](https://openai.com/index/introducing-agentkit/))
- **Gemini Enterprise** has one place listing every agent (Google's own, ones people build in Workflow Builder, and
  ones admins register). Agents are made by describing them in words or in a visual editor, with triggers, steps,
  MCP servers and a person-in-the-loop step, using only the connectors an admin allows.
  ([Agents overview](https://docs.cloud.google.com/gemini/enterprise/docs/agents-overview),
  [Workflow Builder](https://docs.cloud.google.com/gemini/enterprise/docs/workflow-builder))

**The suites (groupware) Mobius is becoming one of**

Andrew sees Mobius becoming advanced groupware, a suite of apps. The suites split it the same way:

- **Nextcloud** (self-hosted, the closest to Mobius's open-standards line):
  - Nextcloud Assistant is the one front end for AI, over separate backend apps, each of which can be turned off.
  - Context Chat indexes the person's files in the background into a vector database on the server, using a
    self-hosted model or any OpenAI-compatible one. Nextcloud's own page notes that someone who lost access to a
    file may still reach it through Context Chat.
  - Context Agent gives the assistant tools across Calendar, Talk, Contacts, Deck and Mail, and chains them.

  ([Assistant](https://docs.nextcloud.com/server/stable/admin_manual/ai/app_assistant.html),
  [Context Chat](https://docs.nextcloud.com/server/latest/admin_manual/ai/app_context_chat.html),
  [Context Agent](https://docs.nextcloud.com/server/latest/admin_manual/ai/app_context_agent.html))
- **Microsoft 365**: one Copilot across the apps, grounded in the semantic index above. Others extend it with
  declarative agents and connectors, which either copy content into the index or reach it live over MCP.
  ([Copilot extensibility](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/overview))
- **Zoho Workplace**: one assistant, Zia, answers across the apps. Its agents are mostly features of Mail (cleanup,
  writing, lead qualifying) that reach into Calendar, People and CRM, and act only with approval.
  ([Zia Agents](https://www.zoho.com/blog/workplace/zia-agents.html), October 2025)
- **Proton** keeps its assistant, Lumo, as its own app. Drive files are added to a chat by hand, not indexed, and
  are deleted after the answer. ([Lumo and Drive](https://proton.me/support/lumo-drive))
- **Notion**: one workspace, with agents in its sidebar (above).
- **Google Workspace**: its own pages were not read for this plan, so nothing here depends on it.

Across the suites:

- The apps stay apps: mail, calendar, files, docs, chat.
- The assistant is one shared layer over all of them, not one per app.
- The index sits under the assistant.
- Agents are the assistant working with a narrower brief.

Mobius already has that shape. What it adds over the suites is that the index, the models and the agent's work are
all on the person's own computer, and the agent's changes show where they happen.

**What this says for Mobius**

1. RAG is a layer under the assistant, not an app. Each product builds one index over everything, filtered by
   access, and the answer links back to the thing. Nobody puts it behind a "Knowledge base" app.
2. Apps take part by describing their things and actions in a shared way (Apple's entities and intents). The
   assistant does the rest.
3. The factory that lasts is the plain one: a name, instructions, what it may use, when it starts. The node-canvas
   kind is the one being withdrawn. Mobius should not build a canvas of nodes.
4. Mobius's difference stays the same: all of this runs on the person's own computer, against their own files, and
   the agent's changes are shown where they happen.

## What Mobius has (main, 27 November 2026)

- **Apps**: 25 in `apps.ts`. Reader and Terminal are modes of Browser and Code, Views is now part of Database (#949),
  and Research becomes a Mobius mode (#950).
- **The agent's hands**: 66 built-in tools (`crates/mobius-host/tests/agent-tools.txt`). They are uneven. Mail,
  Calendar, Tasks, Files, Browser, Code and Drives have their own tools. Notes has one (`notes.search`). Docs, Slides,
  Knowledge, Projects and Canvas have none, and the agent works on them as plain files through `files.*`.
- **Search**: each app searches on its own by matching words (`notes.search`, `files.search`, `mail.search`,
  `contacts.search`). There is no shared index, full-text or vector, anywhere in the crates.
- **Agents**: not a separate app. They are a place inside Home, beside Changes and Activity. An agent has a name,
  instructions, a model and an optional schedule (`packages/shared/src/bots.ts`). It cannot be limited to some apps,
  started by an event, or given sources.
- **Abilities** are skills and extensions in the Store app.
- **Memory** is already visible: Knowledge's How I work page is what Mobius remembers, from the same `memory.md`.

## The rule: app or feature

A thing is an **app** when all three hold:

- it has its own kind of thing (a song, a sheet, a mail account);
- it needs its own main view to work on that thing;
- people open it on purpose to do that work.

Anything else is a **feature**: something that acts on other apps' things, or that is wanted in several places.
Features belong to the shell (the Mobius panel, Ctrl+K, Home's Inbox, comments, Listen) or are a mode of the app
whose things they act on.

Testing the coordinator's draft rule against the 25 apps, it holds, with two corrections:

- **It needs a fourth test: would another app's view do the job as well?** Research, Reader, Views and Terminal
  passed the first three tests and still folded, because another app's view already did their job. Canvas and Design
  pass all four. Slides passes on its own kind (a deck), but its editing could later share Docs' view.
- **"Wanted in several places" makes a feature, but only for actions.** Search, Ask, Listen, Assign and comments are
  actions on things, so they are features. A kind of thing that several apps show (a contact, an event) still has one
  home, either an app or the address book, and other apps show it as a chip.

## The three layers: right in shape, but two layers are missing

The coordinator's three layers (one local store and index; apps as tools through a shared contract; one Mobius agent
working in the open) are the right shape, and match the research. The repo shows the agent layer is mostly built,
and the other two are not:

- **"One local store and index" does not exist yet.** The store is the person's files plus each app's own store, and
  search is per app. The index is the first thing to build.
- **"A shared contract" does not exist either.** Tools are hand-written per app, five apps have none of their own,
  and the item keys used by context chips, item chats and Assign are each made in their own way. The contract should
  be Apple's idea in Mobius terms. Each app declares:
  - **its kinds of thing**: a key, a title, where it opens, and the text to index;
  - **its actions**: the tools it already has, under one naming scheme.

  The index, the chips, item chats, Assign, Ask from anywhere and cited answers then all read the same declaration,
  instead of each app wiring each feature.

## RAG in Mobius: one index, answers that cite

- **What gets indexed.** One index in the core, kept on this computer, over: notes, docs, Knowledge pages, project
  pages, tasks, events, mail, contacts, and the text of files in Files and the connected drives. It updates as
  things change.
- **How it searches.** Word search first, with SQLite's full-text search (public domain) or Tantivy (MIT), so it
  needs no model and no download. Embeddings come later, as a row in Settings › Models › Capabilities: a small local
  model, opt-in, with its size shown, like the voice models.
- **The agent's tool.** One `search.everything` tool returns passages, each with its item's key. The per-app search
  tools stay, for searching inside one app.
- **Citations.** A reply that used passages cites them as small chips. Pressing one opens the item at the passage,
  marked the same way the agent's changes are. This reuses the citation form the Research mode already writes.
- **Project Sources.** The coordinator suggested starting the index in Project Sources (NotebookLM). That is the
  wrong order: Sources should be a scope on the shared index, not its own index. Project Sources then becomes
  "search and answer only from these", which is simple once the index exists. Notes, Knowledge and the Inbox can
  scope it the same way.

## Agent factories and the Agents place

The coordinator's suggestion to turn Agents from a gallery into "your team" is right in substance. The research
gives it a concrete shape, Notion's four fields, which Mobius has half of:

| | Today | Next |
|---|---|---|
| Name and instructions | yes | the same |
| Model | yes | the same |
| Starts when | ask, or a schedule | also on an event: mail from someone, a task assigned to it, a page added to a project, a comment mentioning it |
| Can use | everything | the apps and folders it may touch, plus its Abilities |
| Sources | none | a scope on the index (a project, a notebook, a folder) |

Its runs land in Home's Inbox like the brief and handed-off work, and the approval floors still ask before anything
leaves the person's hands. Making an agent stays a short form, or "make an agent that…" in the panel, which fills in
the form. There is no canvas of nodes.

**Where the suggestion is wrong:**

- **Agents is already in Home.** It is the Agents place beside Changes and Activity, so "reached from Home" is
  already true. The real question is whether it stays a place in Home, or becomes a row of Home's own list.
- **Merging Agents with Abilities would mix up who does the work with what they can do.** Abilities are skills,
  extensions, connectors and MCP tools that any agent, including the main Mobius, can use. They belong in the Store
  as a catalogue, and an agent's "Can use" picks from them. The two places should link to each other, not merge.

## The borderline apps

| App | Rule says | Recommendation |
|---|---|---|
| Agents | a place in Home, not an app | Keep it as a place in Home and give it the "Next" column above. |
| Store (Abilities) | a catalogue, opened on purpose but rarely, like Settings | Keep it, and link it to each agent's "Can use". Andrew's call if it should move under Settings. |
| Knowledge | its own thing (a page of your wiki), its own view, opened on purpose | Keep it. It is also where memory shows (How I work), which covers the agent plan's "memory you can see". |
| Database | its own thing (a table), its own view, now with Views folded in | Keep it. It is the natural home for "an agent watches this table" triggers. |

## Recommended first round (Builder, after check-ins and the speed pass)

One branch, one PR, each piece usable on its own:

1. **The shared contract**:
   - each app's kinds of thing, with key, title, open and text to index, in one manifest;
   - the context chips, item chats and Assign read their keys from it.
2. **The local index**:
   - full-text search in the core over the kinds above, kept current as things change;
   - the `search.everything` tool for the agent;
   - Ctrl+K's results come from the same index.
3. **Cited answers**:
   - passages used in a reply show as chips that open the item at the passage;
   - Project Sources as the first scope on the index.

Built in the first round (`crates/mobius-workspace/src/index.rs`):

- An FTS5 index over notes, docs, Knowledge, slides, tasks, Abilities and project files, kept beside the checkpoints.
  It is brought up to date at each search by checking each file's time and size.
- The `search.everything` tool, which can be narrowed to some apps or to one folder (`within`, so Project Sources is
  `projects/<name>`). Each hit gives a `source` that the reply's fact cites.
- A cited fact from Docs, Slides, Knowledge or Tasks now opens its item, as one from Notes already did.
- Still to do from this round: the shared manifest of kinds for chips, item chats and Assign, and Ctrl+K reading the
  same index.

The round after is the agent factory: "Starts when" with events, "Can use" and "Sources" on each agent, with its runs
in the Inbox. Embeddings come after that, as an opt-in capability.

## Compared with Hermes Agent

Andrew asked on 27 November 2026 how this compares with Hermes Agent (Nous Research, MIT), from
[its site](https://hermes-agent.nousresearch.com/), [docs](https://hermes-agent.nousresearch.com/docs) and
[desktop page](https://hermes-agent.nousresearch.com/desktop):

- **What it is.** One agent and no apps. It runs in a terminal, on a server or on a sandbox service. It is reached
  from more than 20 chat platforms (Telegram, Slack, Signal, Matrix, email and others) through one gateway. A desktop
  app adds chat, sessions and file browsing.
- **What it does well.**
  - Memory that persists, with search across past sessions using SQLite full-text search.
  - Skills it writes from experience and improves as it uses them, in the open agentskills.io format.
  - Scheduled jobs that report to any of those platforms.
  - More than 60 tools, MCP, and any model.

How Mobius compares:

- **Hermes is the agent without the workspace; Mobius is both.** Hermes works on your things through tools and
  replies in a chat. Mobius owns the mail, docs, tasks and calendar, so its work is shown, kept or discarded where it
  happens. Hermes has no equivalent of the dashed changes, Keep and Discard, or the Inbox.
- **It supports this plan's index choice.** Hermes recalls past sessions with SQLite full-text search, the same
  word-search-first start recommended here.
- **Three things worth taking:**
  - **Skills Mobius writes itself.** The agent plan's "show it once" becomes: after a task, Mobius offers to save it
    as an Ability, and improves that Ability when the person corrects it. Mobius's Abilities are already `SKILL.md`
    folders, the same shape as the open standard, so they can be shared both ways.
  - **Reach Mobius from your phone.** Messages already runs on Matrix. A Mobius member in your own space would let you
    ask it from any Matrix app, with the answers and any changes still waiting in the Inbox. This fits the solo
    rule: the space is yours alone.
  - **Running without the window.** Hermes runs on a server. Mobius's plan already says the core should keep running
    without the window, and later on a machine the person owns. Hermes shows people want that.

### Hermes feature by feature

Read on 27 November 2026 from [its docs index](https://hermes-agent.nousresearch.com/docs/llms.txt) and the pages it
links, then checked against this repo.

**Mobius has these already, and in places does more:**

| Hermes | Mobius |
|---|---|
| Checkpoints and /rollback (opt-in, git) | A checkpoint before every write, Undo for each step, and Keep or Discard in place |
| Approval modes, plus a blocklist that holds even in YOLO | Four permissions, floors that always ask, and Always allow |
| Fallback providers | A second model when the first can't answer (`mobius-agent/src/fallback.rs`) |
| MCP client and MCP server | Both. Mobius's server already lets Hermes or Claude Code use its tools (`mobius-mcp/src/server.rs`) |
| Session search (SQLite full-text) | Past-chat search |
| SKILL.md skills | Abilities in the same open format |
| Cron with delivery | Schedules, the morning brief and check-ins, each landing in the Inbox |
| Voice: speech to text, text to speech | Dictation, hold to talk, and Kokoro read aloud on this computer |
| A desktop app showing chat and files | A whole workspace of apps |

**Gaps worth taking, in order:**

1. **It learns as it goes.** After a turn, Hermes reviews what happened and may save a memory or a skill. A setting
   holds those as pending until approved, and /journey shows what it has learned.
   ([memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory),
   [skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills))
   - Mobius has `memory.remember`, but nothing that looks back after a job.
   - Take: "Save this as an Ability" (already agreed), and "Remember this?" as Inbox rows that wait for Keep.
   - Show what was learned as a list in Knowledge's How I work page.
2. **Starting on events.** Hermes runs on webhooks. This is already agreed for mail and tasks; a local webhook (a
   URL only this computer can call) can come later.
3. **Project rules for code.** Hermes reads AGENTS.md, CLAUDE.md and .cursorrules from the project it works in, and
   scans them for injected instructions first.
   ([context files](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files))
   - Mobius's Code app reads none of them.
   - This is small, and makes Mobius useful on any repository out of the box.
4. **Bringing Abilities in.** Hermes installs skills from GitHub repositories and hubs, scans each one, and imports
   from Claude Code, Codex and others.
   - Take: "Add from a repository" in the Store, scanned and shown before it is kept.
   - Take: an import of Abilities from `~/.claude/skills` and `~/.hermes/skills`, all on this computer.
5. **Specialists working in parallel.** Hermes's `delegate_task` runs up to ten child agents, each with its own tools
   and a depth limit. ([delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation))
   - Mobius has none yet.
   - This is the agent plan's fourth direction: the steps of a big job handed to the Agents, each shown as its own
     row.
6. **Memory that stays small.** Hermes caps its memory files and makes the agent merge entries once they are full.
   It also scans each entry for injected instructions.
   - Mobius's `memory.md` has no cap and no scan.
   - Take both, quietly.

**Gaps to skip, or leave for later:**

- More than 20 chat platforms, Kanban boards for agents, batch trajectories for training, credential pools, and
  per-profile homes. These are aimed at running one agent for many people or for research. Mobius is solo, and its
  Agents, Projects and Tasks already cover those jobs.
- Home Assistant, password vaults and image services such as FAL: each one is an MCP server away, through the Store,
  not built in.
- A wake word ("Hey Hermes"): a microphone that is always listening goes against hold to talk. This is Andrew's call
  if he wants one.
- Editors driving the agent (ACP), and an OpenAI-compatible API server: Mobius's MCP server already serves other
  tools. Later, if asked.

**One decision for Andrew:** reaching Mobius from his phone. Hermes's main way in is chat from a phone. For Mobius
that means its Matrix space has to be reachable from outside this computer, and the core has to run while the window
is closed. Three ways to do it:

- a machine he owns, kept on;
- a relay he runs;
- a hosted relay, which costs money.

The recommendation is to wait until the core runs without the window, then use a machine he owns.

## Decisions for Andrew

Andrew answered on 27 November 2026 ("Will go with your recommendations"):

1. **Event triggers: yes.** An agent he made may start on its own when a mail arrives or a task is assigned to it.
   Its results land in Home's Inbox, its changes dashed for Keep or Discard, and the floors still ask before anything
   leaves his hands.
2. **Embeddings: yes, as an optional download, off by default.** Word search comes first either way.
3. **Store stays its own app.** He had first agreed to fold it into Settings. When this plan found the reason above
   to keep it (an Ability is a kind of thing of its own, written and edited in the Store), he chose to keep it, on
   27 November 2026.
4. **Abilities Mobius writes itself: yes** (same day). After a job of several steps, Mobius offers "Save this as an
   Ability" as an Inbox row. This goes into the agent rounds.

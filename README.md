<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/banner-dark.png">
  <img src="docs/readme/banner-light.png" alt="Mobius. Every app. One agent. The AI workspace.">
</picture>

<h3>Mobius is an AI workspace: your everyday apps in one app, with an agent that works across all of them.</h3>

<p>
  <a href="https://github.com/BevActual/mobius/releases"><b>Download</b></a> &nbsp;·&nbsp;
  <a href="#every-app"><b>Every app</b></a> &nbsp;·&nbsp;
  <a href="docs/README.md"><b>Docs</b></a> &nbsp;·&nbsp;
  <a href="#where-it-stands"><b>Where it stands</b></a> &nbsp;·&nbsp;
  <a href="#build-from-source"><b>Build from source</b></a> &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md"><b>Contribute</b></a>
</p>

<p>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-5856D6?style=flat-square"></a>
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-5856D6?style=flat-square">
  <img alt="Built with Rust, Tauri and React" src="https://img.shields.io/badge/built%20with-Rust%20%C2%B7%20Tauri%20%C2%B7%20React-5856D6?style=flat-square">
  <img alt="Status: early preview" src="https://img.shields.io/badge/status-early%20preview-8E8E93?style=flat-square">
</p>

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/hero-dark.png">
  <img src="docs/readme/hero-light.png" alt="Mobius in the Calendar app, with the Mobius agent open in the sidebar beside the week">
</picture>

<sub>Calendar, with Mobius open in the sidebar. Every app works the same way.</sub>

</div>

<br>

## What it is

Mobius is one app that holds the apps you use every day, Notes, Mail, Calendar, Docs, Tasks, a Browser and more, in one
calm design. Built into all of them is **Mobius, the agent**. It sees the app you have open, moves with you from one app
to the next, and carries your work between them: a date from an email becomes an event, a note becomes a document, a
quote becomes a row in a sheet.

It suggests and you decide. Nothing is sent, paid for, deleted or run without your OK.

New here? [Install it](docs/getting-started/install.md), then take the [two-minute tour](docs/getting-started/tour.md).

## Why we're making it

Work today is split across a dozen apps, and AI sits beside them in a chat box that can't see or touch most of it. You
end up copying and pasting between your tools and the AI, and explaining the same context again and again.

Mobius puts the apps and the agent in one place. The agent can follow your work from an email to a task to a document,
and every change it makes shows up in place for you to keep or throw away. It is open source, and you choose the AI
behind it, so you are not locked into one company.

## Who it's for

People whose day is spread across lots of tools and who already lean on AI: founders, freelancers, students and small
teams.

Right now, while Mobius is early, it is for **tinkerers and AI enthusiasts** who like open source, want to choose their
own models, and are happy to try something unfinished and tell us what breaks.

## How we're building it

- **Refine before adding.** A small core of apps made genuinely good first. The rest are added when you want them.
- **Designed with care.** Apple's Human Interface Guidelines shape every screen: one look, one sidebar and one way of
  reviewing changes in every app.
- **You stay in charge.** Mobius proposes and you approve. Keep, Discard and Rewind make its work undoable.
- **Your AI, your choice.** Use your ChatGPT or Claude plan, an API key, OpenRouter, or a model on your own computer, and
  pick a different model for each job.
- **Local and open.** Your notes, documents and settings live in files on your computer, keys sit in the system's
  secret store, and the code is MIT licensed.
- **Built by using it.** Mobius is developed with AI agents that also use Mobius to do real work, so problems surface
  from real use rather than guesses.

<br>

## Every app

A new install starts with **Notes, Tasks, Calendar, Mail, Docs and Browser**. Add the rest from **Abilities** whenever
you want them; apps load the first time you open them, so the ones you don't use cost nothing. Every app shares one
sidebar, one look and one way of reviewing what Mobius changed. More in the [app guide](docs/apps/README.md).

### Assistant

Mobius's own apps, always there.

<table>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/agent.png" alt="The Agent app in Mobius"><br><b>Agent</b> · Home: the desk and your conversations with Mobius, plus named agents for jobs you repeat.<br><sub>Talk to Mobius about anything in your workspace and see what it's working on.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/abilities.png" alt="The Abilities app in Mobius"><br><b>Abilities</b> · The app library, plus connectors, skills and plugins.<br><sub>Start small and add apps and tools when you need them. Removing an app keeps its files.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/settings.png" alt="The Settings app in Mobius"><br><b>Settings</b> · Gateways, models, voice, approvals, privacy and more.<br><sub>Choose which AI does which job and how far Mobius may go on its own.</sub></td>
<td width="50%"></td>
</tr>
</table>

### Write and plan

<table>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/notes.png" alt="The Notes app in Mobius"><br><b>Notes</b> · Quick pages, saved as you type, kept as Markdown files.<br><sub>Capture ideas, checklists and #tags. Mobius tidies, links and fills them in on request.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/docs.png" alt="The Docs app in Mobius"><br><b>Docs</b> · Longer documents with an outline, comments and history.<br><sub>Write briefs and reports. Mobius drafts, proofreads and answers comments in place.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/tasks.png" alt="The Tasks app in Mobius"><br><b>Tasks</b> · Lists of things to do, in the spirit of Apple's Reminders.<br><sub>Keep track of what's due. Mobius adds and plans tasks, and you keep what you like.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/calendar.png" alt="The Calendar app in Mobius"><br><b>Calendar</b> · Your calendars by day, week or month, with due tasks.<br><sub>See your time at a glance. Quick add in plain words, and Mobius finds time for things.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/sheets.png" alt="The Sheets app in Mobius"><br><b>Sheets</b> · Spreadsheets with formulas, saved as CSV files.<br><sub>Budgets and lists any spreadsheet app can open. Mobius fills cells and explains formulas.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/database.png" alt="The Database app in Mobius"><br><b>Database</b> · SQLite databases you query with SQL.<br><sub>Ask questions of your data in words; Mobius writes the query, read-only.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/projects.png" alt="The Projects app in Mobius"><br><b>Projects</b> · A place for one piece of work: its files, rules and memory.<br><sub>Keep everything about a project together, with its own rules for what Mobius may do.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/knowledge.png" alt="The Knowledge app in Mobius"><br><b>Knowledge</b> · What Mobius knows, on pages you can read and edit.<br><sub>No hidden memory: your How I work page and each project's memory, in plain sight.</sub></td>
</tr>
</table>

### Browse and find

<table>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/browser.png" alt="The Browser app in Mobius"><br><b>Browser</b> · A full web browser with tabs, favourites and downloads.<br><sub>Mobius can read pages, compare and pull facts out for you. Signing in and paying stay yours.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/mail.png" alt="The Mail app in Mobius"><br><b>Mail</b> · Your mail on this computer, sorted, with drafts in your tone.<br><sub>Get to inbox zero faster. Mobius writes drafts; it never sends, you press Send.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/search.png" alt="The Search app in Mobius"><br><b>Search</b> · One box for conversations, notes, tasks, docs, mail and pages.<br><sub>Find anything you've kept, or ask a question and Search hands it to Mobius.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/research.png" alt="The Research app in Mobius"><br><b>Research</b> · Ask a question; Mobius searches, reads and writes a report.<br><sub>Get a sourced answer to a real question; follow-ups add to the same report.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/reader.png" alt="The Reader app in Mobius"><br><b>Reader</b> · Pages saved to read later, as clean readable text.<br><sub>Read without clutter, and ask Mobius about the article you're reading.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/files.png" alt="The Files app in Mobius"><br><b>Files</b> · Your whole workspace as a drive, with Made by Mobius.<br><sub>Every note, sheet and doc is a real file you own, in one place.</sub></td>
</tr>
</table>

### Create

<table>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/slides.png" alt="The Slides app in Mobius"><br><b>Slides</b> · Presentations with layouts, presenter notes and a player.<br><sub>Build a deck fast. Mobius makes slides from a document and writes speaker notes.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/design.png" alt="The Design app in Mobius"><br><b>Design</b> · Frames on a canvas, with layers, styles and smart guides.<br><sub>Sketch screens and layouts; borders and PNG export; lock, hide and drag layers to arrange them. Mobius's changes come dashed, to keep or discard.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/photo.png" alt="The Photo app in Mobius"><br><b>Photo</b> · Your pictures, with crops, adjustments and filters you can undo.<br><sub>Edit without losing the original. Mobius can make pictures with your image model.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/music.png" alt="The Music app in Mobius"><br><b>Music</b> · A small studio for writing songs as notes: tracks, piano roll, mixer.<br><sub>Write a tune or a sting. Mobius reads and writes notes, so it can add a bassline.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/video.png" alt="The Video app in Mobius"><br><b>Video</b> · Cut footage into a short film on a timeline.<br><sub>Trim, split and order shots in a filmstrip timeline, and ask Mobius about the cut.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/code.png" alt="The Code app in Mobius"><br><b>Code</b> · A code editor for projects in your workspace, with git.<br><sub>Edit, find, run tests and commit. Mobius proposes changes you review line by line.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/terminal.png" alt="The Terminal app in Mobius"><br><b>Terminal</b> · Run commands in a folder of your workspace.<br><sub>For the jobs that need a command line. Mobius always asks before running one.</sub></td>
<td width="50%" valign="top"><img src="docs/readme/apps/canvas.png" alt="The Canvas app in Mobius"><br><b>Canvas</b> · A whiteboard of stickies, shapes, arrows and pen lines.<br><sub>Think out loud on a board. Send a sticky to Mobius to turn it into a plan.</sub></td>
</tr>
</table>

### Review

<table>
<tr>
<td width="50%" valign="top"><img src="docs/readme/apps/review.png" alt="The Review app in Mobius"><br><b>Review</b> · Everything Mobius changed, from every conversation, in one place.<br><sub>Check what happened while you were away, then keep or roll back.</sub></td>
<td width="50%"></td>
</tr>
</table>

<sub>Screenshots from the current build, with sample data.</sub>

## Your AI, your rules

### Bring your own AI

| Way in | How |
|---|---|
| **ChatGPT plan** | Sign in with ChatGPT, OpenAI's official sign-in for open-source apps |
| **Claude plan** | Through Claude Code on your computer; use counts against your plan's limits |
| **OpenRouter** | Sign in on OpenRouter's own page, no key to paste |
| **API keys** | OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Mistral, xAI, Together AI, Fireworks, Hugging Face |
| **On your computer** | A built-in llama.cpp engine that picks a model to fit your graphics card, or Ollama and LM Studio |

Setting each one up is in [Models and gateways](docs/guide/models-and-gateways.md).

### Safety rules that don't bend

- Choose how far Mobius goes: **Ask first**, **Propose** (the default) or **Act**.
- **Sending, paying, deleting and running commands always ask**, whatever the mode.
- Every change is recorded, and **Rewind to here** takes your work back to any step.
- Keys are kept in the system's secret store and never shown to the interface.

More in [Working with Mobius](docs/guide/working-with-mobius.md) and [Privacy and profiles](docs/guide/privacy-and-profiles.md).

<br>

## Where it stands

Mobius is an **early preview**. The apps above run today, and the agent works across them, but expect rough edges,
missing features and changes between versions. It is not yet ready to be the only place you keep important work.

- **Windows** is the first platform. A macOS build compiles in CI but isn't released yet.
- **Releases** will appear on the [Releases page](https://github.com/BevActual/mobius/releases) as a Windows installer.
  The first, 0.1.0, is being prepared.
- **Coming next:** making the current apps hold up in daily use before adding new ones, then a guided first run and
  signed installers. See the [roadmap](docs/roadmap.md).

Found a bug or have an idea? [Open an issue](https://github.com/BevActual/mobius/issues/new/choose).

<br>

## Build from source

You need Node 22+, Rust stable (the MSVC toolchain on Windows) and git. The Chromium engine also needs CMake and Ninja,
which the Visual Studio Build Tools include.

```
git clone https://github.com/BevActual/mobius.git
cd mobius
npm ci
npm run app                 # build everything and open the app
```

`npm run dev` runs the interface alone in a browser at http://127.0.0.1:5180 with sample data, which is the quickest way
to look around. Setup, tests and the end-to-end suite are in the [developer guide](docs/developers/dev-setup.md).

### How it's put together

Everything that isn't interface is Rust: the core owns permissions, tools, the event log and the model providers, and
runs as its own process. The interface is React and TypeScript in a Tauri shell, using the system web view or Chromium
(CEF). The [architecture overview](docs/developers/architecture.md) walks through it, and design decisions are recorded
in [`docs/adr/`](docs/adr).

<br>

## Contributing

Mobius is young and moving quickly, so [bug reports and ideas](https://github.com/BevActual/mobius/issues/new/choose)
help most right now. If you'd like to send code, read [CONTRIBUTING.md](CONTRIBUTING.md) first. Please follow the
[code of conduct](CODE_OF_CONDUCT.md), and report security problems privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Mobius builds on ideas from [Hermes Agent](https://github.com/NousResearch/hermes-agent) and other open
source projects; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<br>

<div align="center">
<img src="docs/readme/mark.svg" width="40" alt="">
<br>
<sub>Made with care, for people who'd rather their computer worked with them.</sub>
</div>

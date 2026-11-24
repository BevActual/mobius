# Roadmap

Mobius is an early preview. This page says where it stands and where it is going. It is a direction, not a list of
promises or dates. Changes to it land in pull requests like any other doc.

## How we choose what's next

- **Good first, and new when it earns its place.** The apps that exist come first, and using them for real work shows
  what is missing. A new app is added when it makes sense or is needed; an idea that fits inside an app that exists
  goes there instead.
- **One look.** One design style, [Instrument](design/instrument.md), for every screen, in light and dark.
- **The person decides.** Every change the agent makes is reviewable and undoable.
- **Built by using it.** Agents developing Mobius use Mobius itself, through the
  [driver](developers/driving-the-app.md), to find what to fix and improve.

## Where it stands

**Built and usable today**

- The workspace in the [panel look](design/panel-look.md): rounded panels on a darker frame, each named for what it
  holds, a title row with the Go button and a centred tool row, the launcher (Ctrl+K) from anywhere, All apps, split
  view, the desk, the Mobius panel beside the work (closed until you open it, with what waits for you and numbered
  actions), first run, the tray, and Little Mobius.
- The agent: modes (Agent, Ask, Plan, and app modes such as Triage in Mail) and permissions (Ask each time, Review changes, Apply changes, Auto), Keep / Discard / Try another in every app, Rewind to here, plans,
  questions, a message queue, memory, past-conversation search, skills, connectors (MCP client and server), schedules
  and Agents.
- Models: sign-in with ChatGPT, Claude Pro or Max through Claude Code, GitHub Copilot, OpenRouter and Hugging Face; API
  keys for about twenty services plus Azure OpenAI and Amazon Bedrock; local servers, and one-step local models with
  llama.cpp; a model for each job (chat, second, quick, images, listen, speak), and Best fit.
- Apps: Notes, Docs, Tasks, Calendar, Mail, Messages, Browser (with Reader as its reader mode), Files, Search, Research, Sheets, Database,
  Slides, Design, Photo, Music, Video, Code, Terminal, Canvas, Projects, Knowledge, Review, Views, Agents, Activity
  and Store. Meetings are recorded from Calendar and Notes, and contacts show inside Mail and Calendar.
- Messages: Slack, Matrix (encrypted rooms and bridges), Teams chats and Telegram in one list, with a catch-up.
- Comments on anything, sent to Mobius or kept for people.
- A Windows installer with automatic, signed updates.

## Next

- **The panel look**, the current focus: every area a calm, rounded panel on a darker frame, with a centred tool row
  ([the spec](design/panel-look.md)). The shared frame and library pieces come first, then the apps one at a time:
  Mail, Music's browser, Browser and Settings, then Calendar, Tasks, Notes and Docs.
- **Music at parity with Ableton Live**, on Mobius's own audio engine written in Rust
  ([the plan](reference/music-parity.md)). The engine already plays songs, effect racks, instrument stacks,
  modulators and clip envelopes; the window catches up feature by feature. The
  [Music roadmap](reference/music-roadmap.md) keeps the line-by-line status.
- **Fewer, fuller apps.** On 22 November 2026 the plan became 23 apps instead of 30: Reader is already the Browser's reader
  mode, and Research, Search, Views, Review, Activity and Terminal will fold into the apps where people already look
  for them. Each one stays until its new home works.
- **Messages as Mobius's own Slack or Teams**, on Matrix: a local Mobius space run on this computer, agents as members
  and one-to-one calls, built only from MIT or Apache code. Teams of people come later; Mobius is for one person for
  now.
- **Polish the existing apps** against real workflows, one round per app. The
  [apps roadmap](reference/apps-roadmap.md) lists each app's state and its next round.
- **Signed installers**, so Windows names the publisher and its warning fades as people install.
- **Google and Microsoft sign-in** for calendars, drives and Teams chats: built, and waiting on Mobius being registered
  with each ([what it needs](reference/calendar-sign-in.md)).

## Later

- **macOS release.** The shell already compiles on macOS in CI; it needs an end-to-end suite and packaging.
- **Subagents** that split a task and work in parallel.
- **Tauri v3**, once it is released.
- **The Chromium (CEF) engine** in the installer, so the Browser uses one engine everywhere.
- **Plugins** in Store, installed the same way whether free or paid.
- **Sync between devices** and a self-hosted Mobius server, for people who want one.
- **Image generation and speech out** for more gateways.
- **Teams in Messages**: shared spaces for several people, once Mobius has more than one person per workspace.

## Ideas and feedback

Open an [issue](https://github.com/BevActual/mobius/issues) that describes the problem you'd like Mobius to solve.
See [Contributing](../CONTRIBUTING.md).

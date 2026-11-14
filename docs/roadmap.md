# Roadmap

Mobius is an early preview. This page says where it stands and where it is going. It is a direction, not a list of
promises or dates. Changes to it land in pull requests like any other doc.

## How we choose what's next

- **Refine before adding.** The apps that exist get genuinely good before new apps are added. Using them for real work
  shows what is missing.
- **One look.** One design style, [Instrument](design/instrument.md), for every screen, in light and dark.
- **The person decides.** Every change the agent makes is reviewable and undoable.
- **Built by using it.** Agents developing Mobius use Mobius itself, through the
  [driver](developers/driving-the-app.md), to find what to fix and improve.

## Where it stands

**Built and usable today**

- The workspace: the five zones (a slim rail of apps, each app's own sidebar, one toolbar row, the content and the
  right panel), the launcher, the app hub, split view, the desk,
  Mobius in the right panel beside the work (with a Glance at what is open and numbered actions), an inspector
  column for each app's own panels, and Little Mobius.
- The agent: modes (Agent, Ask, Plan, and app modes such as Triage in Mail) and permissions (Ask each time, Review changes, Apply changes, Auto), Keep / Discard / Try another in every app, Rewind to here, plans,
  questions, a message queue, memory, past-conversation search, skills, connectors (MCP client and server), schedules
  and Agents.
- Models: sign-in with ChatGPT, Claude Pro or Max through Claude Code, GitHub Copilot, OpenRouter and Hugging Face; API
  keys for about twenty services plus Azure OpenAI and Amazon Bedrock; local servers, and one-step local models with
  llama.cpp; a model for each job (chat, second, quick, images, listen, speak), and Best fit.
- Apps: Notes, Docs, Tasks, Calendar, Mail, Browser, Files, Search, Research, Reader, Sheets, Database, Slides, Design,
  Photo, Music, Video, Code, Terminal, Canvas, Projects, Knowledge, Review, Views, Agents, Activity and Abilities.
- Comments on anything, sent to Mobius or kept for people.
- A Windows installer with automatic, signed updates.

## Next

- **A bottom dock** for wide panels, such as Music's devices. Other app panels already sit in the inspector.
- **Polish the existing apps** against Instrument and against real workflows, one round per app. The
  [apps roadmap](reference/apps-roadmap.md) lists each app's state and its next round.
- **Music as a full small studio**: more instruments (a morph synth, a sampler), playing from the computer keyboard,
  recording, note tools and automation, built on the shared controls. Drum pads and effects on every track are in. The [Music roadmap](reference/music-roadmap.md) lists each
  one and its status.
- **Signed installers** through Azure Artifact Signing, so Windows names the publisher and its warning fades as
  people install.
- **Google and Microsoft calendar sign-in**, once Mobius is registered with each
  ([what it needs](reference/calendar-sign-in.md)).
- **Connectors**: a settings page, and HTTP and OAuth transports. (They already start and stop without a restart.)
- **Plugins** in Abilities.
- **The Chromium (CEF) engine** in the installer, so the Browser uses one engine everywhere.

## Later

- **macOS release.** The shell already compiles on macOS in CI; it needs an end-to-end suite and packaging.
- **Subagents** that split a task and work in parallel.
- **Image generation and speech out** for more gateways.
- **A Messages app** built only on official APIs (Slack, Discord, Telegram, email). Parked while existing apps come
  first.

## Ideas and feedback

Open an [issue](https://github.com/BevActual/mobius/issues) that describes the problem you'd like Mobius to solve.
See [Contributing](../CONTRIBUTING.md).

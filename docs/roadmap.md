# Roadmap

Mobius is an early preview. This page says where it stands and where it is going. It is a direction, not a list of
promises or dates. Changes to it land in pull requests like any other doc.

## How we choose what's next

- **Refine before adding.** The apps that exist get genuinely good before new apps are added. Using them for real work
  shows what is missing.
- **One look.** Apple's Human Interface Guidelines guide every screen, in light and dark.
- **The person decides.** Every change the agent makes is reviewable and undoable.
- **Built by using it.** Agents developing Mobius use Mobius itself, through the
  [driver](developers/driving-the-app.md), to find what to fix and improve.

## Where it stands

**Built and usable today**

- The workspace: one sidebar per app with the app switcher in its head, the launcher, the app hub, split view, the desk,
  Mobius in the sidebar or pinned beside the page, and Little Mobius.
- The agent: three modes (Ask first, Propose, Act), Keep / Discard / Try another in every app, Rewind to here, plans,
  questions, a message queue, memory, past-conversation search, skills, connectors (MCP client and server), schedules
  and Agents.
- Models: sign-in with ChatGPT, Claude Pro or Max through Claude Code, OpenRouter, API keys for a dozen services, local
  servers, and one-step local models with llama.cpp; a model for each job (chat, second, quick, images, listen, speak).
- Apps: Notes, Docs, Tasks, Calendar, Mail, Browser, Files, Search, Research, Reader, Sheets, Database, Slides, Design,
  Photo, Music, Video, Code, Terminal, Canvas, Projects, Knowledge, Review and Abilities.
- Comments on anything, sent to Mobius or kept for people.
- A Windows installer with automatic, signed updates.

## Next

- **Polish the existing apps** against the HIG and against real workflows, app by app.
- **Signed installers** through SignPath, so Windows no longer warns on install.
- **Google and Microsoft calendar sign-in**, once Mobius is registered with each
  ([what it needs](reference/calendar-sign-in.md)).
- **Connectors**: a settings page, HTTP and OAuth transports, and reloading without a restart.
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

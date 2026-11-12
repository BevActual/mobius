# Mobius documentation

Mobius is an AI workspace: your everyday apps in one app, with an agent that works across all of them.

These pages are for two kinds of reader. If you use Mobius, start with **Getting started** and the **User guide**. If
you want to build or change Mobius, go to **Developers**.

> Mobius is an early preview. It runs on Windows today. Pages describe what is in the app now; plans are kept in the
> [roadmap](roadmap.md).

## Getting started

| Page | What it covers |
| --- | --- |
| [Install Mobius](getting-started/install.md) | Download, install, update and uninstall on Windows |
| [Your first run](getting-started/first-run.md) | Choosing how much Mobius does on its own, and connecting a model |
| [A tour of the workspace](getting-started/tour.md) | The sidebar, the launcher, the desk, the Mobius panel and split view |

## User guide

| Page | What it covers |
| --- | --- |
| [Working with Mobius](guide/working-with-mobius.md) | Ask first, Propose and Act; Keep, Discard and Try another; Rewind; what always asks |
| [Abilities](guide/abilities.md) | Adding and removing apps, skills, connectors (MCP) and plugins |
| [Models and gateways](guide/models-and-gateways.md) | Signing in to a plan, API keys, local models, and a model for each job |
| [Voice](guide/voice.md) | Dictating, and having replies read aloud |
| [Memory and Knowledge](guide/memory-and-knowledge.md) | What Mobius remembers, and how to correct it |
| [Privacy, safety and profiles](guide/privacy-and-profiles.md) | Where your data lives, the privacy report, approvals and profiles |
| [Keyboard shortcuts](guide/keyboard-shortcuts.md) | The default keys, and changing them |
| [Settings](guide/settings.md) | Every section of Settings, and where it is explained |

## Apps

[All apps](apps/README.md), grouped the way the app hub shows them:

- [Assistant](apps/assistant.md): Agent (the desk and your conversations), Agents, Abilities
- [Browse and find](apps/browse-and-find.md): Browser, Mail, Search, Research, Reader, Files
- [Write and plan](apps/write-and-plan.md): Notes, Docs, Tasks, Calendar, Sheets, Database, Projects, Knowledge
- [Create](apps/create.md): Slides, Design, Photo, Music, Video, Code, Terminal, Canvas
- [Review](apps/review.md): Review, Views (dashboards), and comments on anything

## Developers

| Page | What it covers |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | How to report bugs, propose changes and open a pull request |
| [Development setup](developers/dev-setup.md) | Tools to install, building and running from source |
| [Architecture](developers/architecture.md) | The processes, the crates, and how a request flows through them |
| [Testing and CI](developers/testing.md) | Unit tests, end-to-end tests and the GitHub workflows |
| [Shared controls](developers/shared-controls.md) | The menus and other controls every app uses, from `src/ui` |
| [Driving the app from an agent](developers/driving-the-app.md) | The `mobius-drive` MCP server for Claude Code |
| [Releases and updates](developers/releasing.md) | Packaging the installer, signing, and the in-app updater |
| [Architecture decisions](adr/README.md) | Why Mobius is built the way it is (ADRs) |
| [Design](design/workspace-layout.md) | One adaptive surface: the layout rules every app follows |
| [Reference notes](reference/README.md) | Comparisons with Hermes Agent, the bar for each app, market research, and calendar sign-in requirements |

## Help

- [Troubleshooting](troubleshooting.md): problems people run into, and what to do
- [Glossary](glossary.md): Mobius's own words, defined once
- [Report a bug or suggest an idea](https://github.com/BevActual/mobius/issues/new/choose)

## Project

- [Roadmap](roadmap.md): what is built, what comes next
- [Security policy](../SECURITY.md) and [code of conduct](../CODE_OF_CONDUCT.md)
- [Code signing policy](CODE_SIGNING_POLICY.md)
- [License (MIT)](../LICENSE) and [third-party notices](../THIRD_PARTY_NOTICES.md)

## Writing these docs

[Writing the docs](writing-docs.md) is the skeleton every page follows: where a page goes, its shape, naming, style and
screenshots. Start a new page from a [template](templates/README.md). A pull request that changes what a person sees
also updates its page.

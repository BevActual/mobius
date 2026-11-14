# Contributing to Mobius

Thanks for your interest. Mobius is an early preview and changes quickly, so the most useful things right now are:

- **Bug reports.** What you did, what you expected, what happened, and your Windows version. A screenshot helps.
- **Ideas.** Open an issue that describes the problem you'd like Mobius to solve, not only the feature.
- **Small, focused pull requests.** For anything larger, open an issue first so we can agree on the approach.

By contributing you agree that your work is released under the [MIT license](LICENSE), and to follow the
[code of conduct](CODE_OF_CONDUCT.md).

## Principles

- **Refine before adding.** Improving the apps that exist comes before new apps.
- **One look.** Every screen follows one design style, [Instrument](docs/design/instrument.md), and is built from the
  shared controls in `apps/desktop/src/ui` (sidebar, menus, panel slots, review bar) instead of new ones. A control an
  app is missing is added to the shared library, not built inside the app. See
  [Shared controls](docs/developers/shared-controls.md), [Workspace layout](docs/design/workspace-layout.md) and
  [Design rules](docs/design/rules.md).
- **The person decides.** Anything the agent changes must be reviewable and undoable. Sending, paying, deleting and
  running commands always ask.
- **Rust for everything that isn't interface.** Permissions, tools, storage and model providers live in the core. The
  interface is untrusted. See [Architecture](docs/developers/architecture.md).

## Getting set up

You need Node 22+, Rust stable (the MSVC toolchain on Windows) and git. The Chromium (CEF) engine also needs CMake and
Ninja, which the Visual Studio Build Tools include.

```
npm ci
npm run app      # build everything and open the real window
npm test         # Rust tests, then TypeScript unit tests
npm run typecheck
```

[Development setup](docs/developers/dev-setup.md) has every command, and [Testing and CI](docs/developers/testing.md)
covers the end-to-end suite.

## Making a change

1. Fork the repository and create a branch from the default branch.
2. Make your change, with tests: a unit test for logic, an end-to-end spec in `apps/desktop/e2e/` for behaviour in the
   real window.
3. If you changed a Rust type the interface uses, run `npm run gen:types` and commit the result.
4. If the change affects what a person sees or does, update the matching page in [`docs/`](docs/README.md) and retake
   any screenshot it changes, in the same pull request. [Writing the docs](docs/writing-docs.md) says where pages go
   and how they're shaped.
5. Make sure `npm test`, `npm run typecheck` and `npm run check:types` pass, then open a pull request that says what
   changed and why. Add screenshots, light and dark, for interface changes.

A decision that is hard to reverse (a new process, a storage format, an outside service, a change to permissions) gets
an [architecture decision record](docs/adr/README.md).

## Writing style

The interface and the docs use plain words and full sentences, in the names people see in the app (Music, Knowledge,
Abilities). Code comments say why, not what.

## Driving the real app from an agent

If you work with Claude Code, the `mobius-drive` MCP server lets it launch your build and use it. See
[Driving the app from an agent](docs/developers/driving-the-app.md).

## Security

Please don't report security problems in public issues. See the [security policy](SECURITY.md).

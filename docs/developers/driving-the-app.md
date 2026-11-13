# Driving the app from an agent

`apps/desktop/scripts/drive-mcp.mjs` is a development-only MCP server that lets an AI agent, such as Claude Code, start
the Mobius build from your clone and use it: look at the window, read what is on screen, click, type and open apps.

It drives the window through the web view's debugging port, as the end-to-end tests do. No screen capture or operating
system permission is needed: screenshots come from the web view itself.

Mobius is developed this way: agents use Mobius to do real Mobius project work, so problems show up from real use.

## Set it up

1. Build once, in this order (the shell carries the interface):

   ```
   npm run build -w @mobius/desktop
   cargo build --workspace --bins
   ```

2. Register the server with Claude Code, from the root of your clone:

   ```
   claude mcp add --scope project mobius-drive -- node apps/desktop/scripts/drive-mcp.mjs
   ```

   This writes `.mcp.json` at the root, so any Claude Code session in the clone can use it. Node must be on the PATH.

To run it by hand: `node apps/desktop/scripts/drive-mcp.mjs` (it speaks MCP over stdio).

## Tools

| Tool | What it does |
| --- | --- |
| `launch` | Starts the build from this clone (`target/debug`, or `target/release` with `build: "release"`) in test mode, and connects to its window. Options below. |
| `screenshot` | A PNG of the Mobius window. `path` also saves it to a file. |
| `snapshot` | What the window shows, as its accessibility tree (roles, names and text, in YAML). |
| `click` | Clicks an element found by role and name (as a screen reader names it), or by its text. |
| `type` | Types text into an element found by role and name (replacing its contents), or wherever the focus is. |
| `press` | Presses a key or combination, as Playwright names them: `Enter`, `Escape`, `Control+k`. |
| `open_app` | Opens an app by name (`Notes`, `Tasks`, `Sheets`…) through the launcher, as a person would. |
| `hook` | Test hooks: `resize` the window, set the `theme` (`light`, `dark`, `system`), or read the `notices` the app would have shown. |
| `close` | Quits Mobius. A fresh data folder is removed; a kept one stays. |

### `launch` options

| Option | Meaning |
| --- | --- |
| `data: "fresh"` (default) | A new, empty data folder, removed on close |
| `data: "kept"`, `name` | A named data folder under the temporary folder (`mobius-drive/<name>`) that stays between launches |
| `modelUrl`, `model` | Point the agent at a scripted model server |
| `visible` | Show the window on screen (hidden by default) |
| `width`, `height` | Window size |
| `realData: true` | Use your real Mobius data, without the test hooks. Only when you mean it. |

One Mobius runs at a time; `close` it before launching another.

## Safety

The driver only starts builds from your own clone, always in test mode with its own data folder, unless `realData` is
asked for. Your real notes, mail and settings are untouched otherwise. It is never shipped in the installer.

## Recording the launch demo

`npm run demo -w @mobius/desktop` opens your build on Priya's email about the Kestrel P2 brake kit, ready to record the
one workflow (email, task, meeting, reply). It runs in test mode with its own data folder (`mobius-demo` in your temp
folder), a Kestrel P2 task list and calendar, and a pretend mail server on this computer, so nothing touches your real
mail, files or settings and a sent reply goes nowhere. The folder is kept between runs so the model you pick stays;
`npm run demo -w @mobius/desktop -- --fresh` starts again from nothing (and removes the model key saved there). In test
mode keys are kept in a plain file in that folder, so use a key you are happy to keep there.

First time only: choose a model in Settings › Models. Then press "Take care of this" in the Mobius panel. The same
workflow runs with a scripted model in `e2e/demo-workflow.spec.ts`.

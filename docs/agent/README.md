# App guides for the agent

Each file here is a longer guide to one app's files, which the agent reads only when it needs it. The short guide
sent with every turn (`crates/mobius-host/src/workspace_guide.rs`) points to them; the agent reads one with
`skills.read` and the name `app:<file name>` (for example `app:music` reads `music.md`).

The files are built into Mobius, so a change here ships with the next build. Each app's lead owns its file. To add
one, put `<app>.md` here and add it to `APP_GUIDES` in `workspace_guide.rs`.

Keep a guide to what the agent needs to write the app's files well: the fields, what each one does, the ranges,
and a short example. Not how the app looks.

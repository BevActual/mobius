# Store

**Store** (it was called Abilities) is the one place to add things to Mobius: apps, skills, connectors and plugins.
It is a place, like Settings, not an app: open it from **Go › Store…** or the launcher (Ctrl+K, then type "Store").
Mobius stays closed there, except beside a skill you are editing.

(Browser add-ons are a separate thing and are still called *extensions*.)

The left panel has **Search**, which narrows the apps, skills and connectors as you type, then three categories, each
with a count: **Apps**, **Skills** and **Connectors**. **New skill** sits at the top, as New does in every app.

## Apps

A new install starts with the everyday apps, **Notes, Tasks, Calendar, Mail, Docs and Browser**, plus Mobius's own
apps, which are always there.

**Store › Apps** shows every app as a card, grouped by what it is for: its icon, its name and one line on what it does.
An app you have says **Added**, with **Open**. **Remove** in its **⋯** menu (or a right-click) takes it off the Go menu,
the launcher and All apps, but **keeps its files**. **Undo** puts it straight back. An app you don't have yet has
**Add**.

Click a card to open the app's own page. The page shows what the app is for and what it can reach, such as the accounts
you add in Settings › Accounts. It also has **Open** or **Add**. For Mail, Calendar, Messages and Browser, it has a link
to **Adjust in Settings** as well. Opening an app you have not added yet takes you to its page here.

Apps load the first time you open them, not when Mobius starts, so adding more apps does not slow down startup.

See [Apps](../apps/README.md) for what each app does.

## Skills

A skill is a short, named set of steps Mobius follows when you ask for it, kept as a `SKILL.md` file.

- **Store › Skills** lists your skills. Open one to edit when it is used, change its steps one by one, see its
  versions, or **Run** it (in the toolbar, beside the trash button that deletes it).
- Type `/` and a skill's name in the message box to run it.
- **New skill** writes one from scratch. Mobius can also propose a skill, which waits dashed for you to keep like any
  other change.
- **Install a skill…** in the toolbar adds a `SKILL.md` someone shared. Before it is added you see what it is
  for, its steps and what it says it will use. Nothing in it runs until you ask for it, and each tool still asks as your
  settings say.

## Connectors (MCP)

Connectors give Mobius more tools through the [Model Context Protocol](https://modelcontextprotocol.io). Mobius starts
the servers listed in `mcp.json` in the [data folder](../getting-started/install.md#where-your-things-are-kept):

```json
{
  "servers": {
    "notes": { "command": "npx.cmd", "args": ["-y", "some-server"], "env": { "KEY": "value" } }
  }
}
```

A server on the network is listed by its address instead, with any headers it needs, such as an API key. The address
is `https`, or `http` only for a server on this computer:

```json
{
  "servers": {
    "tracker": { "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer your-key" } }
  }
}
```

Mobius speaks MCP's Streamable HTTP to it: it keeps the session the server starts, reads answers sent as JSON or as a
stream, answers the server's pings, and ends the session when it stops. Redirects aren't followed, so a key never goes
to another address. In Store, Add a connector takes an address as well as a command, and writes the `url` entry
for you.

A server that asks for a sign-in instead of a key shows **Sign in** on its row. Mobius signs in the way MCP describes:
it finds the server's sign-in from its protected resource metadata, registers itself with that sign-in server, and
opens the sign-in page in the browser (OAuth with PKCE, the token bound to the server's address). When the browser
comes back, the connector starts. The sign-in is kept in this computer's secret store, refreshed before it runs out,
and removed with the connector. A sign-in server that doesn't let apps register themselves can't be used yet: use a
key in `headers` if it offers one.

Each server's tools appear to Mobius as `mcp.<server>.<tool>`. Each server has its own approval, so the first use asks
as your mode says. Servers start with a minimal environment: only the variables you list under `env` are passed.
Everything a server returns is treated as untrusted text.

**Store › Connectors** shows each server by name (a known service such as GitHub or Linear by its own name) with a
dot on its icon: green when it is running, and red with the reason in one sentence when it could not start, including
where to fix a missing command. Each connector's menu has **Start now**, **Start again** or **Restart**.

**Add a connector…** in the toolbar writes the server into `mcp.json` for you: give the **Command** and its
**Arguments** from the server's own instructions (for example `npx` and `-y @modelcontextprotocol/server-github`),
check the suggested **Name**, and add any **Keys** it needs, such as `GITHUB_TOKEN`. Keys are kept in `mcp.json` on this
computer. The new connector starts at once; there is no need to reopen Mobius.

**Remove** in a connector's menu (**⋯**, a right-click, or Shift+F10) takes it out of `mcp.json`; **Undo** writes the
same entry back. A running one stops at once.
**Edit mcp.json yourself…** in the sheet opens the data folder, for anything the form does not cover.

### Mobius for other apps

The other direction works too. **Settings › Advanced › Other apps › Let other apps use Mobius** turns on an MCP server
inside Mobius, so agents such as Claude Code or Hermes can read the files in your workspace. It listens on this
computer only, needs a token, and is off until you turn it on. **Let them change files** also allows them to create
and edit files; each change is checkpointed, so it can be undone.

## Plugins

Plugins are not available yet. They will get their own place in Store when they are.

## Updates

Mobius's own updates are in **Settings › About › Software Update**. Updates to skills and connectors will get a place
in Store when there are some.

# Abilities

**Abilities** is the one place to add things to Mobius: apps, skills, connectors and plugins. Open it from the app
switcher, the launcher (Ctrl+K, then type "Abilities"), or **Settings › Abilities**.

(Browser add-ons are a separate thing and are still called *extensions*.)

The sidebar has three places, **Apps**, **Skills** and **Connectors**, each with a count. Above them,
**Add** is one menu for everything you can add (an app, a new skill, a skill from a file, a connector), and **Search**
narrows the apps, skills and connectors as you type.

## Apps

A new install starts with the everyday apps, **Notes, Tasks, Calendar, Mail, Docs and Browser**, plus Mobius's own
apps, which are always there: **Agent, Abilities, Projects, Files and Review**.

**Abilities › Apps** lists every other app by what it is for, each with one line on what it does and a switch. Turning
the switch on adds the app to the switcher, the launcher and the sidebar. Turning it off takes it away but **keeps its
files**, so adding it again brings them back. Click an added app's row to open it.

Apps load the first time you open them, not when Mobius starts, so adding more apps does not slow down startup.

If you installed Mobius before Abilities existed, every app stays added. Remove the ones you don't use.

See [Apps](../apps/README.md) for what each app does.

## Skills

A skill is a short, named set of steps Mobius follows when you ask for it, kept as a `SKILL.md` file.

- **Abilities › Skills** lists your skills. Open one to edit when it is used, change its steps one by one, see its
  versions, or **Run** it.
- Type `/` and a skill's name in the message box to run it.
- **Add › New skill** writes one from scratch. Mobius can also propose a skill, which waits dashed for you to keep like any
  other change.
- **Add › Install a skill…** adds a `SKILL.md` someone shared. Before it is added you see what it is
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

Each server's tools appear to Mobius as `mcp.<server>.<tool>`. Each server has its own approval, so the first use asks
as your mode says. Servers start with a minimal environment: only the variables you list under `env` are passed.
Everything a server returns is treated as untrusted text.

**Abilities › Connectors** shows each server Mobius started with a green dot, and each one that could not start with a
red dot; **Show details** says why.

**Add a connector…** (on the page, or in **Add**) writes the server into `mcp.json` for you: give the **Command** and its
**Arguments** from the server's own instructions (for example `npx` and `-y @modelcontextprotocol/server-github`),
check the suggested **Name**, and add any **Keys** it needs, such as `GITHUB_TOKEN`. Keys are kept in `mcp.json` on this
computer. The new connector shows *Added. It starts when Mobius reopens.* until you reopen Mobius.

**Remove…** in a connector's menu (**⋯**, a right-click, or Shift+F10) takes it out of `mcp.json` after you confirm. A running one stops the next time Mobius opens.
**Edit mcp.json yourself…** in the sheet opens the data folder, for anything the form does not cover.

### Mobius for other apps

The other direction works too. **Settings › Advanced › Other apps › Let other apps use Mobius** turns on an MCP server
inside Mobius, so agents such as Claude Code or Hermes can read the files in your workspace. It listens on this
computer only, needs a token, and is off until you turn it on. **Let them change files** also allows them to create
and edit files; each change is checkpointed, so it can be undone.

## Plugins

Plugins are not available yet. They will get their own place in Abilities when they are.

## Updates

Mobius's own updates are in **Settings › About › Software Update**. Updates to skills and connectors will get a place
in Abilities when there are some.

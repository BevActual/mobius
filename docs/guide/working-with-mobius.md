# Working with Mobius

Mobius is one agent that works across all your apps. This page covers how much it does on its own, how you review
what it changed, and how to take anything back.

## Mode and permission

The message box has two controls. **Mode** is the kind of help you want. **Permission** is how much Mobius does
without asking. Both stay as you left them.

### Mode

| Mode | What it does |
| --- | --- |
| **Agent** (the default) | Does the work, across apps if needed. |
| **Ask** | Answers and explains, and changes nothing. |
| **Plan** | Writes a plan and waits for you before doing any of it. |

Shift+Tab in the message box steps through the modes. Some apps add a mode of their own.

### Permission

Pick a permission in the message box. The same choice is in **Settings › Approvals and safety**.

| Permission | What it does |
| --- | --- |
| **Ask each time** | Mobius asks before every step. When it asks, you can allow it once or **always allow** that tool. Standing allowances are listed under **Settings › Approvals and safety › Always allowed**, where you can remove any of them. |
| **Review changes** (the default) | Mobius reads and changes your notes, documents, tasks, sheets and other workspace files without asking. Every change is drawn **dashed** in its app until you keep it. Browsing, mail, running commands and deleting files still ask. |
| **Apply changes** | Like Review changes, but each turn's changes go in at once. **Undo** takes them back. |
| **Auto** | Mobius runs on its own in the apps you switched on, and checks each step first. Your **Quick model** (see [Models and gateways](models-and-gateways.md#a-model-for-each-job)) looks at the tool and its arguments and approves what is clearly safe, for that one time. A risky or unclear step stops as **Needs you**. |

### What always asks

In every mode, these are asked about each time and can never be allowed for good:

- running a command,
- deleting files,
- reading a secret,
- clicking or typing on a web page.

Mobius never sends mail itself: it writes a draft and you press Send. Whatever you blocked stays blocked.

### Per-app access

**Settings › Approvals and safety › What Mobius may do in each app** sets each app to
**Follow the permission**, **Always ask** or **Off**. Paying, sending, deleting and running commands ask whatever you
pick. A
[project](../apps/write-and-plan.md#projects) can set its own levels.

## Keep, Discard, Try another

When a turn changes something, each app shows the same review bar:

| Button | What happens |
| --- | --- |
| **Keep** | The change becomes yours and the dashed edge goes. |
| **Discard** | The app goes back to how it was before that turn. |
| **Try another** | Discards the change and asks Mobius to do it a different way. |

**Why this** shows what you asked in the turn that made the change, so you can judge it against the request.

Where it makes sense the review is finer: Docs shows each edit as a proposal (old text struck, new text marked) with
its own Discard, Code lets you keep or put back each changed line, and a note can be reviewed line by line. When a
turn ends, a card in the conversation names every app it changed. Apps open on what is waiting for you.

The [Review app](../apps/review.md) lists everything Mobius changed, from every conversation, in one place.

## Rewind to here

In the **Activity** app, every turn of the open conversation has **Rewind to here**. It puts every app back as it was right after that
turn and removes the turns that came after. It asks once and names what will change ("Rewind 3 later turns? Mail,
Sheets will change."), and it can be undone for a moment afterwards.

Rewind works because Mobius takes a checkpoint of your workspace before every file change and before each turn. The
checkpoints live in their own store and never touch a folder's own git history.

## Plans and questions

- **Plan first.** Ask for a plan and Mobius proposes its steps as a checklist without doing anything. **Start** it,
  change the steps first, or do it yourself.
- **Questions.** When Mobius needs something from you, it asks with a few choices or room for your own words. The
  turn waits, and the question survives a reload.
- **Queue.** Messages you send while Mobius is working wait in a queue. Each can be edited or removed.
- **Take over.** While a task is running you can take control, then **Hand back** or **Stop**.

## Signing in to websites

When a page Mobius is using needs a sign-in, it shows **Needs you: sign in to … for this task**. You sign in yourself,
in the page, and your password manager can fill it. Mobius never sees the password.

## Web pages are not instructions

Text that comes from web pages, email and other outside sources is treated as untrusted data, never as instructions to
Mobius. A page cannot tell Mobius to do something on your behalf.

## Schedules

**Settings › Schedules** asks Mobius something at a time of day, on the days you choose (a morning brief, say). Each
run is a new conversation, and it asks before acting as usual.

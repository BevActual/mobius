# Mobius the agent, and its panel: what comes next

Andrew asked on 26 November 2026 how Mobius should grow as an agent, alongside products like Claude Duet, ChatGPT's
Dots and agent mode, and Grok Bot, given what Mobius is becoming. He said "sounds good" to the directions below and to
starting with the visible co-worker, background work landing in the Inbox, and the panel pieces in the first round.
What gets built, and in what order, stays his call; this page is the plan to decide from.

## What the others do (from their own pages, read 26 November 2026)

- **Claude Duet** (Anthropic, research preview, 21 October 2026). One ongoing thread, typed or spoken, with a
  morning brief on what matters across connected apps. It looks every few hours, not constantly, and only writes when
  something needs the person. Work runs in a cloud computer with its own browser while the person's devices are off,
  and it says when a task is done or needs review. Sending, paying, signing and deleting are always shown first and
  wait; moving money between accounts is refused even when asked. Gap Anthropic names: you cannot watch its browser as
  it works. ([Introducing Claude Duet](https://www.claude.com/resources/articles/claude-duet),
  [TechCrunch](https://techcrunch.com/2026/10/22/claude-duet-app-is-anthropics-bet-on-agents/))
- **ChatGPT agent** (OpenAI, July 2025). A mode in the composer. It works on its own virtual computer and narrates
  what it is doing on screen. The person can interrupt at any point, take over the browser (to sign in), pause, ask
  for progress, or stop with partial results. It asks before real-world actions; "Watch Mode" requires the person to
  supervise critical ones such as sending mail. Finished tasks can repeat on a schedule.
  ([Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/))
- **ChatGPT Pulse** (OpenAI, September 2025). Research runs overnight from memory, chats and connected apps, and the
  morning brings a few cards for that day only. "Curate for tomorrow" and thumbs steer the next one; nothing acts on
  its own. ([Introducing ChatGPT Pulse](https://openai.com/index/introducing-chatgpt-pulse/))
- **Dots, Meta Muse, Grok Bot, Instinct**: named by the press as the same wave of agents that come back to you first.
  Their own pages could not be read from here, so nothing below depends on them.

What they share: one place where the agent talks to you first, work that carries on without you, and a hard stop
before anything that leaves your hands. What none of them do well yet, and Mobius can: **show the work where it
happens**. Duet says outright you cannot watch it. Mobius already owns the apps, so its changes are dashed in place,
kept or discarded there. That is the line to push.

## What Mobius has already (main, 26 November 2026)

- The composer's modes and permissions (Ask each time, Review changes, Apply changes, Auto), Plan first, approval
  floors that are always asked (sending, running commands).
- Changes dashed in place with Keep, Discard, Try another; checkpoints before every write, the last turn reviewable.
- Home's Inbox: chats that need you, apps changed while you were away, suggested replies, mail with no reply yet;
  Working, with Stop (#920).
- Settings › Schedules: a request at a time on chosen days, each run its own conversation.
- Memory (`memory.md`, listed in Settings with Forget), past-chat search, Skills/Abilities, the Agents app's named
  agents, the launcher (Ctrl+Space, hold to talk), dictation and on-device voice.
- The Mobius panel: one conversation at a time, Plan card, Mobius asks, queued messages, You have control.

So most pieces exist. What is missing is how they feel together: you cannot see Mobius working in an app, background
work does not come back as one thing to answer, and the panel is a chat log rather than a view of the work.

## The agent: five directions

1. **A visible co-worker.** While Mobius works in an app, it is there: its own indigo cursor and selection move to
   where it is acting, the dashed edge grows around what it touched, and a small pill in the app says what it is doing
   ("Filling in the quote table"). Pressing it, or starting to type, pauses Mobius at once (ChatGPT agent's
   interrupt and takeover); Resume carries on. This is the Duet gap turned into Mobius's strength.
2. **Hand it off, it comes back to the Inbox.** "Do this in the background" on any request, or Assign to Mobius on a
   task, a mail, a doc. The work runs while you do something else (or with the window closed, once the core runs
   without the window), and its result lands as one Inbox row: what it did, the changes still dashed, Keep all or
   open to look. Schedules feed the same rows. Nothing leaves your hands without the floors asking.
3. **It comes to you, carefully.** A morning brief in Home (spoken, if you like): what's due, what changed, what it
   prepared. Suggestions are Inbox rows that wait ("Draft a reply to Ana?"), never actions. Like Duet it looks every
   few hours, not constantly, and you can say what you want to hear about.
4. **Specialists and plans for big jobs.** A large request starts with a plan you can edit (Plan first already
   exists); steps can be handed to the Agents app's specialists, each shown as its own row in the panel.
5. **Memory you can see.** What Mobius remembers lives as Knowledge pages you can read and edit, not a hidden file;
   "show it once" turns a demonstration into an Ability.

Ask from anywhere joins these: select something in any app and ask about it in place, with the answer dashed beside
it, without opening the panel.

## The panel: what changes

- **What it sees.** A row of chips over the composer: the app, the open item, the selection ("Sheet: Q3 quotes,
  B2:D14"). Remove one to leave it out. This replaces guessing what "this" means.
- **Live steps.** Running work is a list of steps, not a stream of text. Each done step says what changed with a link
  that jumps to the change in its app, and its own Undo. The step running now is the only thing that moves.
- **A working pill.** When the panel is closed, Mobius working is a small pill by the Mobius button (step 3 of 5,
  Stop). It opens the panel only when Mobius needs an answer.
- **Conversations live on the thing.** A doc, a project or a task has its own conversation with Mobius, found again
  by opening that thing; the panel shows the one for what is open, with All chats a step away.
- **Replies made of real pieces.** An event, a table, a draft reply arrives as the app's own piece, editable in the
  reply, and Keep puts it in place.
- **Running jobs.** Background work and schedules are listed under the conversation, each with Stop: no tabs, per the
  layout rule. Built in the third round: every other chat Mobius is working on (handed off, scheduled or left
  running), with Stop and a press to open it.
- **Assign to Mobius.** Built in the fourth round: Assign to Mobius in a task's menu and on a mail message starts a
  chat of its own in the background (the open chat stays as it is), listed under Also running, landing in the Inbox.
  Any app offers it by sending `mobius:assign` (apps/desktop/src/assign.ts) with the ask, a title and its app.
  Notes and Docs offer it on a note's or document's row (Notebooks, Documents), and Projects on a project's row.
  A chat opened while its turn runs elsewhere (handed off, scheduled, assigned) shows it running, with Stop and the
  pill, from the chat list's word, before it has said anything.

## Open standards, no account

Background work runs in the person's own Mobius core, on their machine. Results are files and rows in their own
store. Models are theirs to choose, local included. Nothing here needs a Mobius account or server. A later option to
keep the core running on a home server or a machine they own fits the same design.

## Recommended first round

One shell branch, one PR, in this order, each piece usable on its own:

1. **The panel shows what Mobius sees**: context chips from the app's open item and selection, removable, sent with
   the turn.
2. **Live steps with jump and Undo per step**: the Plan card and tool steps become one step list; a step that changed
   something links to it and undoes just that change (the checkpoints exist; this exposes them per step).
3. **The working pill**: Mobius working while the panel is closed shows by the Mobius button, with Stop; it opens the
   panel only when Mobius asks.
4. **Hand it off to the Inbox**: "In the background" in the composer; the run keeps going while the panel is closed
   and the result lands in Home's Inbox as one row with Keep all and Open.

The visible co-worker (an in-app cursor and pill in each app) comes right after, app by app with the Apps lead, once
the step list knows where each change is. Its shell part came in the second round: Pause and Resume on the working
pill, and typing in the app Mobius is working in pauses it at once (it takes over; the keystroke goes through).

Decisions for Andrew, later: whether the morning brief is spoken by default; how often Mobius may look on its own;
whether conversations move onto items (that changes where old chats appear).

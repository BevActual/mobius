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

Shift+Tab in the message box steps through the modes.

#### App modes

Some apps add a mode of their own after the shared three, shown only while you are in that app.
Leave the app and the mode counts as Agent; come back and it is on again.

| Mode | In | What it does |
| --- | --- | --- |
| **Triage** | Mail | Sorts the inbox into Reply, Later and Archive, and drafts the replies. It never sends. |
| **Review** | Docs, Notes | Comments and suggests, and never edits the text. |
| **Analyse** | Sheets, Database | Answers with charts and tables, and never changes a cell. |
| **Debug** | Code | Reproduces the bug, then proposes the fix. |

An app's own buttons can turn its mode on for you: Mail's **Triage** action in the Mobius panel sends its turn in
Triage whatever the message box says.

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

### Reading the web for one question

When Mobius asks to search the web or read a page, the card also offers **Allow for this question**. It covers
searching and reading web pages until Mobius has answered that message, so a piece of research asks once instead of
at every search. Clicking, typing or signing in on a site still asks each time, and the next message asks again.
No other kind of step can be allowed this way.

### Per-app access

**Settings › Approvals and safety › What Mobius may do in each app** sets each app to
**Follow the permission**, **Always ask** or **Off**. Paying, sending, deleting and running commands ask whatever you
pick. A
[project](../apps/write-and-plan.md#projects) can set its own levels.

## The Mobius panel

The Mobius icon at the right end of every app's tool row opens the Mobius panel beside your work; it starts closed.
It holds the conversation, the message box, and a few places an app fills in for what is open, and nothing else: an
app's own panels, such as the outline in Docs, are [panels of their own](../getting-started/tour.md#panels). Each
changes with what Mobius is doing.

- **Resting.** At the top, a **Glance** card: up to three live facts about what is open or selected. Tasks shows
  *Your day* (overdue, due today, flagged), Calendar the *Rest of today* (still to come, the next start, free time
  until 6 pm), and Sheets the sum, average and count of the cells you selected. Then **Waiting for you**: conversations
  with a question or approval for you, and the changes from your last conversation, with **Keep all**, **Discard all**
  and **Try another**. Then the **Actions** list: the app's own actions first (Mail's **Get to zero** and **Triage**),
  then Mobius's ideas for what is open, four at most. Press 1 to 4 to pick one while the panel has the focus. Last,
  **Earlier chats** to pick up again.
- **Working.** Mobius's plan as a checklist and each tool it uses as a plain sentence, with **Stop**. With the panel
  closed, a small pill beside the Mobius icon says what it is doing (and *Mobius needs you* when it waits for you);
  press it to open the panel. **Pause** on the pill stops Mobius where it is and leaves the apps to you; it then says
  *Paused* and where it stopped, with **Resume** to carry on.
- **Asking.** A question is a card of numbered choices, the first outlined as the suggestion; press its number, or
  type your own answer in the message box. An approval is a dashed card that says what will happen. **Allow once**
  is on the right (it names the action, such as **Send** or **Delete**, for what can't be undone); **Decline** and
  **Always allow** sit quietly on the left. What can't be undone never offers Always allow.
- **Done.** A card naming each app the turn changed, and, where the app has one, its own **Result** view of what was
  made. Both end in **Discard**, **Try another** and **Keep**. Each step that changed something has its own **Undo**,
  which puts back only what that step changed; a file a later step changed again is left as it is.

**Send in the background** (Alt+Enter, or the plus menu) hands a message off: the panel steps aside while Mobius
works, and when it is done the result waits in Home's Inbox with **Keep all** and **Open**. Text you have selected in
the app goes with a message as its own chip, which you can remove before sending.
- **Failed.** A turn that failed is marked in red until the next one. In [Activity](../apps/assistant.md#activity)
  it is listed with what needs you, with **Try again**, which sends the same request once more.

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

[Changes](../apps/assistant.md#changes), in Home, lists everything Mobius changed, from every conversation, in one place.

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
- **Chats live on what they are about.** Each note, document, sheet or task list keeps its own chat with Mobius:
  open the note and its chat is there in the panel, as you left it. Away from any item (Mail's list, Calendar, the
  browser), the panel shows one general chat. The panel doesn't move while Mobius is working, or while what it
  changed waits for **Keep**. **All chats**, in the panel and on the Agent page, lists every chat with what it is about.
- **Also running.** Work Mobius is doing in other chats (sent in the background, started by a schedule, or left
  running when you moved on) is listed under the open chat, each with what it is doing (*In the background*,
  *Working*, *Needs you*) and **Stop**. Press one to open that chat.
- **Ask from anywhere.** Select words in a note or document, or cells in a sheet, and press **Ctrl+Shift+J**. A card
  opens beside them: ask about what you chose and the answer appears there, in Ask mode (Mobius reads and answers,
  changing nothing), without opening the panel. Ask a follow-up in the same card, or **Continue in chat** to carry on
  in the panel. **Replace selection** puts the answer in place of the words you chose (as your own typing, so Undo
  takes it back), and **Copy** copies it. **Esc** closes it and puts you back where you were, with the words still selected.
- **Assign to Mobius.** Right-click a task in Tasks, or a message in Mail (or use the open message's ⋯), and choose
  **Assign to Mobius**. It works on it in a chat of its own, in the background, without opening the panel or touching
  the chat you have open. Assigning it again while Mobius is still on it says so rather than starting a second run. A task it does as far as it can, ticking it off only when it is finished; a message it reads
  and prepares what it needs (a draft reply, a task, an event), sending nothing. The result lands in Home's Inbox,
  named after the item; one you stopped, or one that went wrong, says so there rather than that it finished.
- **Take over** (beside Stop). While a task is running you can take control: Mobius pauses at the next safe step and the
  apps are yours. Then **Hand back**, optionally telling it what you changed or what to do next ("I booked it myself;
  just send the summary"), or **Stop**. Starting to type in the app Mobius is working in (the note it is writing, say)
  takes over at once, so the two of you never write over each other; Resume on the pill, or Hand back, carries on.
  What you change while you have control is yours: it is not listed with Mobius's changes, and its Undo leaves it be.
  A step Mobius had in hand when you took over says *Not run: you took over*; it reads what is there again and decides.

## Signing in to websites

When a page Mobius is using needs a sign-in, it shows **Needs you: sign in to … for this task**. You sign in yourself,
in the page, and your password manager can fill it. Mobius never sees the password.

## Web pages are not instructions

Text that comes from web pages, email and other outside sources is treated as untrusted data, never as instructions to
Mobius. A page cannot tell Mobius to do something on your behalf.

## Schedules

**Settings › Schedules** asks Mobius something at a time of day, on the days you choose (a morning brief, say). Each
run is a new conversation, and it asks before acting as usual. Schedules run while Mobius is open, including with its window closed
and only its icon in the tray. When a run finishes, a notice says it is ready to review (if **When a request finishes**
is on in Settings › Notifications), and clicking it opens that conversation. A run missed while Mobius was not running
happens once when it next starts, on the same day.

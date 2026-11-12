# Assistant apps

## Agent

The Agent app is Mobius's home. It opens on the **desk** and holds your conversations.

![The Agent app in Mobius](../readme/apps/agent.png)

- **The desk** shows what waits for you first (questions and approvals, each answerable in place), then what Mobius is
  doing, what is open in your apps (an app Mobius changed carries a dashed edge until you look), and what is scheduled
  next.
- **The sidebar** lists conversations. Its tabs are **Sessions** (your conversations), **Activity** (opens the
  [Activity app](#activity)) and **Agents**.
- **The message box** takes text, pictures and files, dictation (hold Ctrl+Space), `/skill` names, the mode
  (Shift+Tab), the model and the effort.
- **In a turn**, Mobius shows its plan as a checklist, each tool it uses as a plain sentence ("Added 6 tasks to P2
  build"), and, at the end, a card naming each app it changed.

The same conversation is available in every app through the Mobius button, pinned beside the page, or in
**Little Mobius** (Ctrl+Shift+M).

## Agents

Agents are named helpers for jobs you repeat. Open them from the **Agents** tab in the Agent app's sidebar.

- Each agent has a name, its instructions, a model, and how it starts: **when you ask**, or **also on a schedule** (weekdays or every day, at a time).
- **Make an agent from a conversation**: its name comes from the conversation's title and its instructions from what
  you first asked.
- An agent works under the same mode and per-app settings as Mobius. Its card says what it may touch ("Off: Mail.
  Always asks: Browser. Everything else follows your mode, Propose.").
- In a [project](write-and-plan.md#projects), **Ask a bot** sends an agent off to do something on the side, and what
  it reports comes back into the thread.

## Activity

Activity is the history of what Mobius did, and what is waiting for you. Open it from **Mobius** in the app switcher,
or type "Activity" in the launcher (Ctrl+K).

![The Activity app in Mobius](../readme/apps/activity.png)

- **The page** leads with what **needs you**, what is **running**, the **changes to review** (Keep or Discard), what
  finished today and what is scheduled. Below that, everything that happened, grouped Today, Yesterday and earlier: each
  line is the app's icon, one sentence ("Sent an email to Sam Okafor") and the time. Something that failed is shown in
  red.
- **The open conversation's turns** are listed with [Rewind to here](../guide/working-with-mobius.md#rewind-to-here).
- **The sidebar** narrows the list: **Everything**, **Needs you**, **By Mobius**, **By you**, **Can't be undone**
  (sending, paying, deleting and running commands), then **By app**.
- It reads the same log as **Settings › Approvals and safety › Activity**, which stays on this computer.

## Abilities

Where you add apps, skills, connectors and plugins. See the [Abilities guide](../guide/abilities.md).


![The Abilities app in Mobius](../readme/apps/abilities.png)

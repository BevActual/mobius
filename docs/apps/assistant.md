# Assistant apps

## Agent

The Agent app is Mobius's home. It opens on the **desk** and holds your conversations.

![The Agent app in Mobius](../readme/apps/agent.png)

- **The desk** opens with one greeting ("Good afternoon"), the date and what is in flight ("1 waiting for you · Mobius
  is working"), and suggestions to start from. Under it: **Now** (questions and approvals, each answerable in place,
  and what Mobius is doing, with Stop), **Recent** (the last few conversations, with when each was last active; one
  press picks it up again), **In your apps** (the one thing in each worth a look: your next event, the first task due, who wrote your newest
  mail, the note or doc you edited last; one press opens it, and an app Mobius changed carries a dashed edge until you
  look) and **Next**
  (what is scheduled).
- **The sidebar** starts with a search, then your conversations (grouped by agent once you have more than one),
  what is scheduled, and the ones you archived. **Create** at its head starts a new conversation. **Agents** and
  [Activity](#activity) open from the foot of the rail.
- **The message box** takes text, pictures and files, dictation (hold Ctrl+Space), `/skill` names, the mode
  (Shift+Tab), the model and the effort.
- **In a turn**, Mobius shows its plan as a checklist, each tool it uses as a plain sentence ("Added 6 tasks to P2
  build"), and, at the end, a card naming each app it changed.

The same conversation is available in every app in the right panel beside your work (the Mobius button shows and hides it), or in
**Little Mobius** (Ctrl+Shift+M).

## Agents

Agents are named helpers for jobs you repeat. Open them from **Agents** at the foot of the rail, or type "Agents" in
Ctrl+K. The sidebar lists your agents, then **From Mobius**: the runs of your agents waiting for you to review.

![An agent's page in Mobius](../readme/apps/agents.png)

- Choosing an agent opens **its page**. The toolbar shows its name, when it runs, and **Run now**, which starts a new
  session with it and sends its instructions. The page has four parts: **What it does** (its instructions and model,
  with **Edit**), **When it runs**, **What it can use** (from Settings › Approvals and safety) and **Recent runs**, its sessions,
  each opening with one press.
- **+** beside the list makes a new agent, on the same page.
- Each agent has a name, its instructions, a model (type one, or pick from the models you have), and how it starts:
  **When you ask**, or **On a schedule** (weekdays or every day, at a time; it still starts when you ask, too). A
  schedule runs as the agent, with its instructions and model.
- An agent's **More** button (⋯), or a right-click on it, has New session, Edit, Move up, Move down and Remove. Mobius
  itself is built in, so its menu only starts a session.
- **Make an agent from a conversation**: its name comes from the conversation's title and its instructions from what
  you first asked.
- An agent works under the same permission and per-app settings as Mobius. Its card says what it may touch ("Off: Mail.
  Always asks: Browser. Everything else follows your permission, Review changes.").
- In a [project](write-and-plan.md#projects), **Ask a bot** sends an agent off to do something on the side, and what
  it reports comes back into the thread.

## Activity

Activity is the history of what Mobius did, and what is waiting for you. Open it from **Mobius** in the app switcher,
or type "Activity" in the launcher (Ctrl+K).

![The Activity app in Mobius](../readme/apps/activity.png)

- **The list** is laid out like Mail's inbox. In **Today** it leads with what **needs you**, what is **running**, the
  **changes to review** (Keep or Discard), what finished today and what is scheduled, then what happened. Each line is
  the app's icon, one sentence ("Sent an email to Sam Okafor") and the time. An indigo dot marks a change Mobius made;
  something that failed is shown in red. A changed file is listed under the app it belongs to (a sheet under
  Sheets). **Open** on a line takes you to its app.
- **The right side** shows what you chose: a line's app, who did it and when, with **Rewind to here** to undo a
  change Mobius made, or a conversation with its turns and
  [Rewind to here](../guide/working-with-mobius.md#rewind-to-here).
- **The sidebar** chooses where to look: **Needs you**, **Today**, **This week**, **Everything**, then each app.
- **The toolbar** chooses who did it: **All**, **Mobius**, **You**, or **Can't undo** (sending, paying, deleting and
  running commands).
- It reads the same log as **Settings › Approvals and safety › Activity**, which stays on this computer.

## Abilities

Where you add apps, skills, connectors and plugins. See the [Abilities guide](../guide/abilities.md).


![The Abilities app in Mobius](../readme/apps/abilities.png)

# Memory and Knowledge

Mobius can remember short facts about you between conversations, such as how you like documents laid out or who is on
your team. You can always see, correct and forget what it remembers.

## How memory works

- What Mobius remembers is kept in one plain Markdown file, `memory.md` in the
  [data folder](../getting-started/install.md#where-your-things-are-kept), one fact per line.
- Every remembered fact is added to Mobius's instructions at the start of each turn.
- Remembering and forgetting are tools like any other and follow your [permission](working-with-mobius.md#permission).
  By default Mobius asks before it remembers something ("Mobius would like to remember…").

## How I work

The **Knowledge** app opens on **How I work**, the page only you and your Mobius see. It shows what Mobius remembers,
grouped as About you, Preferences, Projects, People and Learned skills.

- Something Mobius learned waits at the top under **Waiting for you**, drawn **dashed**, until you **Keep** it, or say
  **Not true** and it is forgotten.
- Point at a line (or reach it with Tab) to **Edit**, **Forget** or **Share** it. On a line, Enter edits it and Delete
  forgets it (for what Mobius learned, Enter keeps it and Delete says Not true). Add a line, with its kind, in the row
  at the foot of the page, or with the **+** beside a section's name.
- **Settings › Memory** lists the same facts with **Forget**.

## Shared knowledge

Knowledge also keeps pages that are shared, such as a project's memory page. Changes to them are offered rather than
written straight in: a line from How I work you chose to share, a line Mobius proposes, or one from someone else. Each
waits under **Suggested changes** with **Decline**, **Edit first** and **Keep**, and either answer can be undone.

Pages are Markdown files in `workspace/wiki/`, listed in the sidebar under their folder: **Pages**, **Projects** and
**Shared**. Their earlier versions come from the workspace checkpoints. The **Versions** button (the clock at the end
of the page's toolbar) lists them by day and shows what putting one back would change, line by line: what comes back
in green, what goes in red. **Put this version back** restores it, and **Undo** in the line that appears brings the
page back as it was.

## Project memory

Each [project](../apps/write-and-plan.md#projects) has its own memory page in Knowledge. What Mobius proposes in a
project's threads waits dashed in the project until you keep it.

## Searching past conversations

Mobius can search your past conversations when it needs something you said before. It only matches words that you or
Mobius wrote, not tool output or attachments.

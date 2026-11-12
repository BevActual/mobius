# Memory and Knowledge

Mobius can remember short facts about you between conversations, such as how you like documents laid out or who is on
your team. You can always see, correct and forget what it remembers.

## How memory works

- What Mobius remembers is kept in one plain Markdown file, `memory.md` in the
  [data folder](../getting-started/install.md#where-your-things-are-kept), one fact per line.
- Every remembered fact is added to Mobius's instructions at the start of each turn.
- Remembering and forgetting are tools like any other and follow your [mode](working-with-mobius.md#the-three-modes).
  By default Mobius asks before it remembers something ("Mobius would like to remember…").

## How I work

The **Knowledge** app opens on **How I work**, the page only you and your Mobius see. It shows what Mobius remembers,
grouped as About you, Preferences, Projects, People and Learned skills.

- Something Mobius learned is drawn **dashed** until you **Keep** it, or say **Not true** and it is forgotten.
- **Settings › Memory** lists the same facts with **Forget**.

## Shared knowledge

Knowledge also keeps pages that are shared, such as a project's memory page. Changes to them are offered rather than
written straight in: a line from How I work you chose to share, a line Mobius proposes, or one from someone else. Each
waits under **Suggested changes** with **Decline**, **Edit first** and **Keep**, and either answer can be undone.

Pages are Markdown files in `workspace/wiki/`. Their earlier versions come from the workspace checkpoints, so any page
can be put back as it was.

## Project memory

Each [project](../apps/write-and-plan.md#projects) has its own memory page in Knowledge. What Mobius proposes in a
project's threads waits dashed in the project until you keep it.

## Searching past conversations

Mobius can search your past conversations when it needs something you said before. It only matches words that you or
Mobius wrote, not tool output or attachments.

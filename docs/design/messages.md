# Messages in the panel look

Messages is Mobius's own Slack or Teams, built on Matrix (Andrew agreed 22 November 2026; see the
[build plan](../reference/build-plan.md)). This page is its design: how the app looks and behaves in the
[panel look](panel-look.md). The model is Slack ([help](https://slack.com/help)) for the shape and Linear for the
calm; where this page and the panel look disagree, the panel look wins.

Three rules from the plan shape everything here:

- **Only the person sends.** Mobius drafts, summarises and finds; a message leaves only when the person presses Send.
- **One list of every chat.** Slack, Teams, Matrix rooms and bridges, and the person's own Mobius space sit in one
  list, not one app per service.
- **MIT or Apache pieces only.** Nothing from Element, Element Call or Synapse is embedded or copied, including their
  icons, sounds and layouts ([licences](../reference/licences.md)).

## The panels

| Panel | Where | What it holds |
| --- | --- | --- |
| Conversations | left | The rail of places, then search and the list of chats |
| The conversation | centre | Header, the message log, the reply box |
| Thread, Person or Details | right, one at a time | Opens from a message or the header; closes with Esc |
| Mobius | right, as in every app | Closed at first; Ctrl Shift M opens it |

The tool row holds, centred: the conversation's name with its member count, then Search in this chat (Ctrl F), Call (one to
one only, while teams wait on Andrew), and Details. Icons have tooltips that name the key.

## Conversations panel

- **The rail.** A 44 px strip down the panel's left edge, inside the panel and with no line beside it: **All**, then
  **Mobius space**, then one entry per account. Each entry is the service's own mark in one tone, grey at rest and
  ink when chosen, with the 3 px ink bar on its left. No coloured letter tiles: colour belongs to people's avatars.
- **Search** at the top: "Find a conversation" (Ctrl T, as Slack also allows; Ctrl K stays the command window).
- **Sections** for each account with the panel look's 28 px rows and outline icons: `#` for a channel, the person's
  avatar for a direct chat, stacked avatars for a group. Sections fold; the folded state is remembered.
- **Unread** is the name in ink and semibold, with no dot. **A mention of you** adds a grey count pill on the right.
  Muted chats are in the faint tone. Nothing here is indigo.
- **From Mobius** is the last section when Mobius has something waiting (a draft reply, a "catch me up"), using the
  grey Mobius mark like Files. It's hidden when empty.
- The list ends with a quiet note ("That's every chat", with counts), not an empty panel.

## The conversation

- **Header** (40 px, no line under it): the name, the topic in the secondary tone on one line, and on the right the
  avatars of up to three members with a count. Clicking the avatars opens Details.
- **Runs, not bubbles.** Messages are left aligned in a centred column about 680 px wide. A run (one person's
  messages within five minutes) shows a 28 px avatar, the name in ink, the time in the faint tone, then the
  messages. Your own runs look the same; Slack doesn't flip them and neither do we.
- **Day headings** are a small centred label in the secondary tone that sticks to the top while scrolling. No rule
  across the log.
- **New** marks the first unread message: the word in ink with a thin ink line at 50 %, as today. Not red, not
  indigo.
- **A mention of you** is the name as an ink chip on the soft tone, and a faint grey fill behind that run.
- **On hover** a small floating panel at the run's top right offers React, Reply in thread, Copy, and More. The same
  tools are on the keyboard (R react, T thread, C copy, Shift F10 more).
- **Reactions** are grey pills under the message; yours has an ink outline. **Threads** show as one line: up to three
  avatars, "4 replies", "last today at 9:12".
- **Links and files** become cards inside the run: the title, the site in the faint tone and a small picture if it
  has one. A file card shows its kind, name and size, and opens in Files.
- **Encrypted rooms this device can't read** show one centred line ("Encrypted: verify this device in Settings ›
  Messages to read") with a Verify button, not a placeholder per message.

## The reply box

- Sits at the foot of the column, the same width, as a rounded panel-style box with the hint "Enter sends, Shift
  Enter new line" under it while it's empty.
- **Formatting** (bold, italic, code, list, link) appears in a small row inside the box only once you type or press
  Ctrl Shift X, so the box stays quiet.
- **Draft with Mobius** sits inside the box on the left, as in Mail. The draft appears in the box dashed in indigo
  with the panel look's floating **Why · Discard · Try another · Keep** bar. Keep turns it into ordinary text in the
  box. It is never sent until the person presses Send.
- Send is a round button that turns ink when there is something to send.

## Right panels

- **Thread** opens beside the conversation, never over it: the message it hangs from, then the replies as runs, then
  its own reply box with "Also send to #channel" as a checkbox under it.
- **Person** shows the contact card (avatar, name, where they are, local time when the service knows it) with
  Message, Call and Open in People.
- **Details** shows the topic, members (with Mobius agents in their own group, below people), pinned messages and
  files shared here.

## Mobius in Messages

- **Catch me up.** In a chat with more unread than fits on screen, the New marker gets a "Catch me up" button.
  Pressing it puts a summary above the New marker: a dashed indigo block with the points, who raised each one, and a
  link to jump to each. It is Mobius's work, so it is dashed until the person keeps or dismisses it. Across chats,
  the same summary comes from the Mobius panel ("Catch me up on everything").
- **Agents as members.** An agent in a Mobius space room is a member like a person, with the Mobius mark as its
  avatar and "Agent" after its name in the faint tone. What an agent posts in the space is plain text like anyone's;
  the dashed indigo look is only for work waiting on the person's say.
- **Nothing outside the space speaks for the person.** In Slack, Teams or a bridge, agents never post; they only
  draft into the reply box.

## Empty and setup states

- No accounts: the app's EmptyState, "Bring your chats here", with Add an account (opens Settings › Messages).
- Mobius space setting up: one status line with a thin progress bar, then the channels appear. Failure shows the
  reason in one line and Try again.
- A chat with no messages: "No messages here yet. Say hello." centred in the column, with the reply box focused.

## Keys

| Key | Does |
| --- | --- |
| Ctrl T | Find a conversation |
| Ctrl F | Search in this chat |
| Alt Up, Alt Down | Previous or next chat; with Shift, unread chats only |
| Up (in an empty box) | Edit your last message |
| Esc | Close the right panel, then mark the chat read |

## Not in this pass

Teams (several people sharing a space) waits on Andrew; accounts are solo for now. Group calls, huddles, canvases,
workflows and custom emoji are left out.

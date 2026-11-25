# Mail: conversations, attachments, hover actions

The look for the Mail round of 25 November 2026 (one app at a time to a refined state). It follows the
[design guide](guide.md), with Superhuman and Gmail as the references, and Part B (B4 to B8) of Design's panel-look
review of Mail. Where this page and the guide disagree, the guide wins.

## Conversations

As Gmail's conversation view groups them
([Gmail Help: conversation view](https://support.google.com/mail/answer/5900)):

- **One row per conversation.** Messages are one conversation when they share the first Message-ID in their
  `References` (or are that message). The row shows the latest message, with the count after the sender's name in
  muted figures when there is more than one. It is unread or flagged if any of its messages is.
- **Opening a row opens its latest message.** The earlier messages of the conversation, your sent replies included, sit
  folded above it, one line each (who, their first words, when). A click opens one in place; another folds it.
- **Done (E) and Later (H) act on the whole conversation** in the list, as Superhuman's do, and Undo puts back all of
  it. The arrows and J and K move from conversation to conversation.

## Attachments

As Gmail shows them, under the message: a chip for each file with a small mark for its kind (PDF, IMG, XLS, DOC, PPT,
ZIP), its name and its size ("19 bytes", "14 KB", "2.3 MB"). A click saves the file to Downloads, next to any file of
the same name as "name (2).ext", and says so under the chips. Programs (.exe, .bat, .msi, .ps1 and the like) are never
saved; the chip says why.

## Done and Later on hover

As in Superhuman, hovering a row in the Inbox shows Done and Later over its time, with their keys in the tooltips. They
are a mouse shortcut only: the keyboard has E and H, and screen readers have the row's menu (Shift+F10), so the hover
buttons are hidden from both.

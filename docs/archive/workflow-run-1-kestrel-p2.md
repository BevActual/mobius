# Mobius workflow run 1: Kestrel P2 across apps

> Copied from the claude.ai page of the same name on 14 November 2026, when the project moved to the repo. Links point at the repo copies.

Nov 11, 2026

## What I ran

The apps each work on their own; the handoffs between them are where Mobius loses people. I played one real job end to end: plan the Kestrel P2 build, write it up, share it with the team, then fix the budget from inside Sheets.

1. In Agent: "Plan the Kestrel P2 build, 8 units, $6,000k cap: make a task list, put the key days on the calendar, start a budget sheet." Mobius asked which week (9 March 2027 is a Tuesday), then made 6 tasks, 5 events and a budget sheet.
2. Same conversation: "Write a one-page build plan doc, a short kickoff deck, and draft an email to Priya, Leo, Mara and Sam with both."
3. In Sheets, Mobius from the sidebar: "Get this under the cap. Try 7 units first."

How: the real app (upbgu0 at 4618fc4) built on my cloud machine, with Mobius's model replaced by a script I wrote turn by turn, so I could see exactly what Mobius is told and what each tool does. Nothing ran on your PC. Real-model behaviour (tone, judgement) still needs a run on your machine.

## What worked

- Mobius's question card ("which week do you mean?") with tap-to-answer choices felt right.
- The work card (Working, step 1 of 3, Take over, Stop) made a multi-app job easy to follow.
- Tasks opened beside the chat on its own as Mobius added to it, which is the morphing feel we want.
- Dashed proposals with Keep / Discard / Try another and "Why this: you asked …" read clearly in Tasks, Sheets and Slides.
- Dots on Sheets and Calendar in the app switcher showed where Mobius had been.
- Mobius in the Sheets sidebar carried on the same conversation, so nothing was lost moving between apps.
- Trust marks on facts (green for yours, dotted orange for a guess) were easy to read.

## Friction at the handoffs

The biggest problem: pressing Keep in one app quietly keeps everything Mobius did in that turn, in every app. All of these are with the Builder or the App owner now.

| What happened | Why it matters | Who fixes it |
| --- | --- | --- |
| Keep on the Tasks bar ("Mobius changed this list") also kept 5 calendar events and the budget sheet I never looked at. Same in Slides: keeping the deck also kept the doc. | People approve things they have not seen. | Builder |
| Mobius in Sheets says "Sees this sheet", but when I typed "get this under the cap" Mobius was told nothing about the sheet or the selected cell. | "This" means nothing to Mobius; it has to guess. | Builder |
| The chat lists "Add a task" six times and "Write a file" twice, and calls a new email "Draft a reply". "Has used Tasks, Calendar, Sheets" isn't clickable. | You can't see what was made or get to it from the chat. | Builder |
| Calendar opened on today; the new events were in March 2027 with nothing pointing there, and they weren't dashed for review. | Changes Mobius made are hard to find. | Builder, App owner |
| Sheets and Slides opened on "No workbook open" / "No deck open" right after Mobius made one. | An extra hunt after every handoff. | App owner |
| Choosing another app while the screen was split replaced the chat pane, so the conversation vanished. The follow-along pane stayed on Tasks while Mobius worked in Calendar and Sheets. | Lose your place mid-task. | Builder |
| "Email the team the doc and deck" could not be done: no mail account means the draft is lost, and Mail can't attach files anyway. | The plan never leaves the computer. | Builder |
| Mobius quoted a total it had just written into the sheet without reading the result back; the figure was wrong and nothing caught it. | Wrong numbers sound confident. | Builder |
| The new doc was reviewed as raw Markdown; the six-day build week drew as six separate chips; Propose mode still asked permission to read the clock. | Polish. | App owner, Builder |

## What we might need next

These are gaps, not bugs. Each came from a moment where the next natural step had nowhere to go. Your call on which, if any, to build.

1. **Projects that fill themselves.** Mobius made a list, five events, a sheet, a doc and a deck for one job, and nothing ties them together. Projects stayed empty and Mobius can't file into one. A "Kestrel P2" project that gathers the conversation and everything made for it would be the home for a piece of work. The launcher's Recent row should show those things, not app names.
2. **Live links between apps.** After the budget dropped to 7 units, the doc and deck still said 8 units and $330k over. A number in a doc or slide that follows its cell in Sheets, and a task, event and doc that point at each other, would keep a project true.
3. **People.** Priya, Leo, Mara and Sam exist only as words. There is no contact list, so Mobius can't address an email or invite anyone to the crash test.
4. **Sending work out.** Email this doc or deck (as a PDF or link), with attachments in Mail, and drafts that wait in Drafts until an account is connected.
5. **One review place.** A single list of everything Mobius changed and hasn't been kept, across apps, with Keep or Discard per item. Activity or Files' "Made by Mobius" could be it.
6. **Mobius knows where you are.** Whatever is open (and selected) travels with your message as a visible chip you can remove.

## Run 2: using Mobius to build Mobius (11 Nov, evening)

Run 1's top four problems are fixed. Keep now stays in its own app, the open note travels with your message as a chip, the chat says "Added 7 tasks", and the turn ends with one card listing every change and a Keep all button.

This time I tracked our own fixes in Mobius: I made a Build Mobius project, started a thread from it, and asked Mobius to turn yesterday's findings into a task list for each thread plus a note.

- **Projects don't hold the work yet.** A thread started from the project doesn't say it's in the project, Mobius isn't told about the project, and the lists and note it made aren't filed there.
- **The project page leads with 18 permission dropdowns.** The work itself (threads, what's been made, memory) is below the fold.
- **Links in a note only reach other notes.** Linking to the Builder fixes list in Tasks stays plain text.
- The review card's Undo buttons are heavier than Keep, and some tooltips stay on screen after a click.

Sent to the Builder. Added to the list above: a project should collect what its threads make, and links should reach any item in any app.

## Run 3: writing by hand, with comments

I wrote the v0.1.0 release notes in Docs myself, left a comment on them, then asked Mobius to answer it. Two serious problems turned up.

- **My own work was labelled as Mobius's.** The doc I typed right after a Mobius reply showed up as a Mobius change, ready to Discard. Pressing Discard would have deleted my own writing.
- **Mobius can't see comments.** "Answer the comment" fails: comments aren't sent to Mobius, and Mobius has no way to reply to or resolve one.
- **Ctrl+K and the All apps grid act differently.** Typing "New document" in Ctrl+K only offers to ask Mobius, so pressing Enter sent it to Mobius as a chat message.

Sent to the Builder and the App owner. Added to the list above: comments as a two-way channel between people and Mobius.

## Next workflows to run

- [ ] Supplier mail in: a Veltro quote arrives in Mail; turn it into a task, a sheet row and a note (needs a test mail account).
- [ ] Research to decision: compare three pack suppliers in Browser and Research, then write "Why Veltro" in Docs.
- [ ] Meeting day: from the calendar event, open the deck, present it, take notes, turn the notes into tasks.
- [ ] Comments loop: Priya comments on the doc, "Send to Mobius" fixes it, the fix shows up in the deck too.
- [ ] A run on your PC with a real model, to judge Mobius's own choices, not just the plumbing.

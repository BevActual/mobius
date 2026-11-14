# Demo moments: real-model results

One section per moment in the demo scripts (`scripts.md` beside this file), run on Andrew's PC with the Demo workspace profile and his
model through the driver. The bar (PR #337): the first real thing within 5 s of the ask, the last within 15 s (or 30 s
for several-step moments, Triage, Plan my day and Compare, when results arrive one by one), and Keep offered. From
round 12 on, each run records three times: ask to first real thing, ask to last, ask to Keep offered.

| Moment | Run on | Model | Time (first / last / Keep where recorded) | Meets the bar | Weak |
| --- | --- | --- | --- | --- | --- |
| Home and Tasks: Plan my day (#293, #334) | 14 Nov, 42bae04 + #339, chip | Sonnet 5.5 | 29.2 / 37.4 / 48.9 s | Content nearly, time no | No Focus hour; moves a task due tomorrow to today |
| Mail: Triage (#291, #334) | 14 Nov, 42bae04 + #339, after Plan my day, no New chat | Sonnet 5.5 | 35.1 / 38.1 / 51.4 s | Content nearly, time no | 36 of 40 covered; Veltro draft commits; unasked meeting and task |
| Calendar: Find a time with… (local, after #289) | 14 Nov, 62b8354, typed (suggestion read "Find time for…") | Sonnet 5.5 | 17.6 s, nothing dashed | No | 8 slots, none dashed, no invite drafted |
| Notes: Meeting notes (#333) | 14 Nov, 13c5b55 (#333), chips | Sonnet 5.5 | 17.0 / 17.5 / 17.0 s; to-dos 23.3 / 24.1 s | Content nearly, time no | Extra "jigs" action; "end of week" left undated; spares wrong on main's older seed |
| Docs: Shorter in place, then One-page brief (#295) | 14 Nov, 75dc9eb | Sonnet 5.5 | Shorter 15.9 s; brief 15.0 s | Nearly | Try another longer than the first; brief 655 words |
| Slides: Make this a deck (local, from Docs) | 14 Nov, 75dc9eb, chip on the brief | Sonnet 5.5 | 17.6 s to the deck | Nearly | Two slides with five bullets |
| Browser: Compare these (#296) | 14 Nov, 75dc9eb, Files › Open then chip | Sonnet 5.5 | 28.7 s to the note, 41 s to end | Nearly: correct, no cards, too slow | Links tied to the session's port |
| Files: Tidy this folder (local, after #288) | 14 Nov, 62b8354, typed (no suggestion) | Sonnet 5.5 | 36 s to done | No | Moves not shown before; two approvals to list; Undo leaves 6 files and 12 folders |
| Sheets: What stands out? (local; chart to follow) | 14 Nov, 65bb3a5, chip | Sonnet 5.5 | 22.7 s to cells and chart | Content yes, time no | Unformatted average; chart below the grid |
| Code: a failing test in Glance (local) | 14 Nov, a99e095, Glance card | Sonnet 5.5 | 14.7 s to passing | Yes | Explanation twice; raw prompt shown as the person's turn |

## Home and Tasks: Plan my day (#293)

### Round 11 (42bae04 with #339's timings, main's seed, Saturday)

- **Time:** first real thing (a tasks.update) 29.2 s, first dashed block 33.9 s, last (the draft) 37.4 s, Keep about
  48.9 s, end 47.6 s.
- **Where it goes (turn timings):** three model rounds take 38.9 s, of which Claude Code start-up is 3.1 s. Round 2 writes
  all 13 calls in one 22.4 s generation (3,008 tokens out); the app's tools then run one at a time at 0.4 to 1.0 s each
  (8.2 s in all); the closing reply round adds 10.2 s. Printout: `mobius-moments-shots\round11\P-turn-timings.txt`.
- **What appeared:** six blocks from 11:40 to 17:45, local time, no overlaps, all before 18:00; overdue tasks timed; one
  reply (Priya); "Can wait" in one line.
- **Weak:** no Focus hour ("the afternoon is too full", with 4 h 27 min free); "Pay the Veltro deposit", due tomorrow,
  was moved to today.

### Round 10 (22ff2bd, back to back)

- **Time:** first block 37.4 s, last 39.1 s, one draft card, Keep bar 49.0 s, end 54.3 s (slower than round 6).
- **What appeared:** three overdue tasks timed and a Focus hour, local time, no overlaps, before 18:00; one reply
  (Priya), "Can wait" one line; tasks due later left alone.
- **Weak:** about two and a half times the bar.

### Round 6 (d3ce34a)

- **After #315 (before #307):** clock.now now gives local time and weekday; the day was planned from 09:36. First block
  24.4 s, last about 26.0 s, Keep bar 37.4 s, end 42.8 s.
- **What appeared:** four task blocks and a Focus hour, all after now and before 6 pm, tasks timed to match, list in
  order.
- **Weak:** still two replies drafted; "Can wait" two lines; on a Saturday it plans a full working day (the seed's
  workday dates put the week on Monday).

### Earlier

- **Run on:** 14 November 2026 (Saturday, 08:29 Pacific), a69bcfa, "Plan my day" chip on Home. On Home the chat opens
  in the main view (Agent split beside Calendar), not the side panel.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** first dashed block 23.7 s, last block about 25.1 s, two draft approvals 25–26 s, Keep bar 38.2 s, end 43.5 s.
- **What appeared:** four dashed blocks between 16:40 and 17:55, none over an event or past 6 pm; the same four tasks
  timed; two suggested replies (Sam, Priya), nothing sent; the reply lists the day in order and matches the blocks.
- **Weak:**
  1. clock.now returns only UTC and the model took it as local time, so an 08:30 morning was planned as if it were
     16:30: the 11:00 and 15:00 tasks due today were "already past", one task due today was dropped, the overdue car
     insurance left out, and no Focus hour "before 6 pm".
  2. A task due tomorrow (Pay the Veltro deposit) was timed and called due today.
  3. Two replies drafted, not one.
  4. "Can wait" is a long sentence, not one line.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round3\` (A-planday-panel.txt).

## Mail: Triage (#291)

### Round 11 (42bae04 with #339's timings, after Plan my day, no New chat)

- **Time:** first real thing (a tasks.add) 35.1 s, first draft 36.5 s, last draft 38.1 s, Keep about 51.4 s, end 50.3 s.
- **Where it goes (turn timings):** four model rounds take 46.9 s, of which start-up is 3.5 s; app tools 1.5 s. The first
  word only appears in the last round, so nothing shows for 35 s. Printout: `mobius-moments-shots\round11\T-turn-timings.txt`.
- **Fixed since round 10:** Triage showed in Mail's panel straight after Plan my day (#332); no second Priya draft; Archive
  in one line (22 messages); amounts as the mail writes them; nothing for other people; nothing sent or archived; three
  approval cards, each naming the right email.
- **Weak:**
  1. Covers 36 of 40 (Reply 6, Later 8, Archive 22); Dana's jigs, the train, the sign-in alert and a GitHub issue unnamed.
  2. The Veltro draft commits to the order and the deposit, a decision that is Andrew's.
  3. The brake test plan task is due tomorrow; Priya asked for the end of the week.
  4. Not asked for: a "Re-plan test order with Sam" event on Monday, and an Inbox task for Finance.

### Round 10 (22ff2bd, back to back)

- **Run after Plan my day and Keep.** The panel still held that chat, so "Triage the unread" needed a New chat (#332
  pending).
- **Time:** last draft about 41.1 s; Keep bar 56.3 s; end 61.6 s.
- **What appeared:** all 40 covered, one line each (Reply 7, Later 13, Archive 20), no ids; Priya's meeting tomorrow
  at 14:00 and her draft mentions it; brake test plan task in Kestrel P2, the parts list task reused rather than
  duplicated; nothing sent or archived; approval cards named the right emails; good calls (no draft to Veltro or
  Northfield, flagged the board-slide date mismatch, the security alert).
- **Weak:**
  1. Still about four times the bar.
  2. A second draft to Priya beside Plan my day's: Triage did not look at existing drafts.
  3. Not asked for: an event and draft to Sam, and a Finance task in Inbox.
  4. Priya's two asks on different dates (the seed's parts-list task was due the next day; fixed in the seed, 0f83eff).
  5. "£1,240" where the mail says 1,240 GBP.
  6. On a Saturday, "tomorrow at 2 pm" is a Sunday: record on Monday to Thursday.

### Scripted run, round 3

- **Run on:** 14 November 2026 (Saturday), a69bcfa, Mail › Inbox, the panel's "Triage the unread" action (it sends
  "Triage my 41 unread messages."). Before #307.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** search 5.7 s; events about 41 s; tasks from 41.5 s; four draft approvals 44.5–46.9 s; last draft about
  47.7 s; Keep bar 64.9 s; end 70.3 s.
- **What appeared:** all 41 sorted (8 read in full, the rest from previews): Reply 5 with 4 dashed drafts (Priya, Sam,
  Northfield, Veltro), Later 18, Archive 18 (not moved). Priya's two asks became two tasks; a dashed "P2 brake kit
  walkthrough with Priya" tomorrow at 14:00, which her draft mentions. Seven tasks in Inbox, an extra event with Sam.
  Nothing archived or sent, no newsletter answered.
- **Weak:**
  1. 48 s to the last draft and 70 s to the end, against fifteen.
  2. "Send Priya the updated parts list" duplicated: it already exists in Kestrel P2; new tasks went to Inbox.
  3. Priya's two asks got different dates (tomorrow and the 20th) though she said both by the end of the week.
  4. "Her earlier email (#2)": an internal reference shows.
  5. Approval cards name the wrong source email ("Asked by text in Ardent Cells's email" for the Veltro draft).
  6. Archive grouped into six lines rather than one per message; only 8 read in full (#307).
  7. Keep bar 17 s after the last draft.
  8. After Plan my day the Agent split stays open in Mail and the Triage action is hidden until it is closed.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round3\` (B-triage-panel.txt).

### Pipeline check, round 1

- **Run on:** 14 November 2026, pipeline check, before #291. Built from #282 (e2e2e4e, main plus the demo seed), Demo
  workspace profile, light theme. Mail had no Triage action, so "Triage my inbox" was typed in Agent mode. Not the
  scripted run yet.
- **Model:** Sonnet 5.5 through the Claude Code gateway; 2 requests, 28,194 tokens in (11,475 cached), 1,284 out.
- **Time:** stop button 0.2 s; first step ("Looking through your mail") 6.2 s; first words about 13 s; done 18.2 s.
- **What appeared:** a sorted summary in the panel (Act on, Do soon, Good to know, No action needed, Skip). Priya's two
  asks and the review tomorrow, Veltro's quote and deadline, Sam's hour, the Northfield slots and Finance's budget lines
  were all picked out correctly; newsletters were put in Skip. No drafts, tasks or events (Agent mode asks first).
- **Weak:**
  1. "30 unread" while the inbox shows 41: the mail search seems to stop at 30, so the Ardent quote, Priya's board-pack
     slide, Ana's hiring mails and the security alert were never seen.
  2. Internal ids shown to the person: "(id 1)" in the text and source chips labelled "id 1 — From your stuff".
  3. Priya's mail called "a duplicate of her earlier message": the profile had not been reset after an earlier open
     from main's stub seed, so the old 010 mail was still there. Press Reset before each run.
  4. Home in the demo says "Nothing waiting for you" while Mail has 41 unread and Tasks 8 due today.
  5. About 13 s before the first words; the whole run is over the fifteen-second bar even before drafts are made.
  6. The demo profile starts with no model; it had to be pointed at Andrew's in the demo profile only.
- **Screenshot:** on Andrew's PC, `C:\Users\andrewbevington\softwareprojects\mobius-moments-shots\` (02-mail-before,
  04-triage-first-result, 06-triage-finished, and triage-output.txt).

## Calendar: Find a time with… (local, after #289)

- **Run on:** 14 November 2026 (a Saturday), 62b8354. Typed "Find an hour with Sam Okafor this week" in Week view.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** 17.6 s to the end of the turn; no dashed slot ever appeared.
- **What appeared:** a text answer with eight free slots across next week, recommending Tue 11:00, and an offer to add
  it or draft an invite. Every slot checked: none clashes with Sam's or Andrew's calendars, all in working hours.
- **Weak:**
  1. Eight slots instead of three at most.
  2. Nothing dashed in Calendar and no invitation drafted.
  3. Sam's mail says any afternoon works; it led with a morning.
  4. Seed: run on a Saturday, the `{{date:+N}}` offsets put part of "this week" on the weekend. Dates need to skip
     weekends, or runs and recordings happen on weekdays.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round2\`.

## Notes: Meeting notes (#333)

### Round 10 (13c5b55, main's seed)

- **Time:** Meeting notes: nothing real before 17.0 s, then the change and Keep together at 17.0 s, panel reply 17.5 s,
  end 21.2 s, no cards. Make a to-do list (after Keep): tasks and reply 23.3 s, Keep 24.1 s, end 28.5 s, no cards.
- **What appeared:** it drew the change straight away, under "# Kestrel P2 stand-up": Summary, Decisions, Actions, then
  the transcript unchanged (additions only). Three of four decisions right; four actions right with owners, "tomorrow"
  and "two days" worked out. To-dos: it read the task lists first, added to Kestrel P2, skipped the Veltro deposit
  (already a task) and flagged the overlap with "Send Priya the updated parts list".
- **Fixed since round 9:** no longer asks before writing; the write-up sits under the heading; to-dos go to Kestrel P2
  without duplicating the existing deposit task.
- **Weak:**
  1. Over the bar: nothing real for 17 s.
  2. "Order eight spares for now": main still has the older, ambiguous spares line ("Eight or ten?"); the clearer line
     ("Just the eight, no spares for now") is in this branch (#282) and not yet on main.
  3. An extra fifth action, "Dana: jigs expected to arrive around 2026-11-16", which is an arrival, not a task; it also
     became a to-do.
  4. "End of week" left as words, so two tasks have no date (should be Friday).
  5. Run on a Saturday with main's `{{date:}}` seed, so the meeting is dated Saturday.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round10\notes-*`.

### Round 9 (8a146d9)

- **Run on:** 14 November 2026 (Saturday), 8a146d9 (#306). Notes › Meetings › Kestrel P2 stand-up, first chip.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** Meeting notes ended at 16.9 s with nothing drawn: it showed the write-up in the panel and asked "Should I
  save it like this?" (no button). After a typed "Yes", the change was drawn at 17.7 s more, about 35 s in all. Make a
  to-do list: four tasks by 9.6 s, end 22.3 s, no cards; the chips came back after Keep.
- **What appeared:** summary, decisions and an owner-and-date checklist above the transcript, transcript unchanged;
  then four tasks with the right days.
- **Weak:**
  1. Asks before writing instead of drawing the change to keep.
  2. One decision wrong ("order eight spares"): the seed's wording was ambiguous; fixed in the seed (d6a7ffe).
  3. The write-up goes above the page's own heading, so the sidebar preview reads "Summary".
  4. Tasks go to Inbox with "Andrew:" and "Sam:" prefixes; two duplicate or overlap existing Kestrel P2 tasks.
  5. Run on a Saturday, the meeting is dated Monday (the seed's working days).
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round9\`.

## Docs: Shorter in place, then One-page brief (#295)

### Round 8 (75dc9eb)

- **Shorter:** 15.9 s; keeps his words ("a plan for the week" survives).
- **Try another:** about 22 s; clearly different, but longer (55 against 40 words).
- **Keep:** that paragraph only; the Ideas chips came back without a New chat.
- **One-page brief:** 15.0 s to the document, 27.0 s end, no cards; every number matches the plan; plan untouched;
  **655 words**, over the 450 limit.

### Round 6 (d3ce34a)

- **Shorter after #312:** 13.6 s to the marked change (95 s before), no edit failed on line breaks. Try another
  24.2 s. Keep changed that paragraph only.
- **Weak:** the second take is longer (56 against 40 words) and close to the first; both turned "a plan for the
  week" into "a weekly plan", which changes the meaning; "For P2, as since kickoff" is clumsy.
- **One-page brief:** 27.4 s, 796 words (before #322's limit).

### Earlier

- **Run on:** 14 November 2026, 8a707aa (before #312's paragraph matching). Build brief, Background's second
  paragraph.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** Shorter to the marked change 95.0 s; Try another under 240 s (end not caught); One-page brief to the new
  document 13.9 s, Keep bar 21.3 s, end 26.5 s, no approvals.
- **What appeared:** Shorter: about 70 words to 45, good text; Keep changed that one paragraph only. The brief, "Build
  brief brief", follows the plan's outline, every number matches the plan, the plan is untouched.
- **Weak:**
  1. Shorter runs as a full agent turn: 95 s, two failed edits on the file's CRLF line breaks, and the panel narrates
     them.
  2. Try another gives the same four points in the same order, mostly the same words, and longer (55 against 45).
  3. The brief is 734 words (the panel says "about 590"), well over a page.
  4. After Keep the Ideas chip is gone; a New chat was needed to reach One-page brief.
  5. Seed: the brief said Ardent quoted 5,400 GBP while the page and mail say 5,800; fixed in the seed (4848c3e).
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round5\`.

## Slides: Make this a deck (local, from Docs)

### Round 8 (75dc9eb)

- **Time:** deck file 17.6 s; end 29.1 s; no cards.
- **What appeared:** `slides/Presentations/Build brief summary.md`, safe name, no empty file. Every fact is in the
  brief. Title slide without bullets; 4 of 8 slides with bullets; three statement and section slides (warm, dark, warm
  "92,000 GBP all in"); notes on every slide; Play from the start runs 1 to 8.
- **Weak, minor:** slides 6 and 8 have five bullets; slide 3 reduces "done" to one chassis's run.

- **Run on:** 14 November 2026, d3ce34a (#318). One-page brief first (27.4 s, 796 words), kept, New chat, then the
  second chip on the brief.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** deck in the sidebar 25.3 s; Keep bar 32.2 s; end 37.3 s; no approval cards.
- **What appeared:** eight slides: accent title, Background, Goal, a dark Parts slide, Packs and motor, a warm
  statement ("No slack: the full-load test stays regardless."), Schedule and budget, a dark Next. Notes on every slide,
  adding to the bullets. Play goes full screen with presenter view.
- **Weak:**
  1. Facts not in the brief (Ardent's price, "Kore has no date", spares at 12,000 GBP) while the panel says all figures
     are copied from the document: it read the plan too.
  2. The colon in the title failed the first write again and left an empty `slides/Presentations/Build brief`, counted
     as a second deck in the bar.
  3. Six of eight slides are title and bullets; the title slide has bullets; slide 7 packs two days per bullet.
  4. Play starts on the selected slide, not slide 1.
  5. The brief it came from was 796 words.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round6\` (A4-slide-1 to 8, A5-play).

## Browser: Compare these (#296)

### Round 8 (75dc9eb)

- Pages opened from Files › pages with Open; chip pressed; **no approval cards**.
- **Time:** note written 28.7 s; Keep bar 35.7 s; end 41.0 s.
- **What appeared:** `notes/General/Battery packs compared.md` (safe name, no empty file). All 21 values correct and
  linked to their words; no "not stated" rows (Maker, Capacity, Voltage, Weight, Lead time, Price, Warranty).
- **Weak:** still about twice the bar; links still carry the session's port and token (59887 here, 60136 the launch
  before), so they break after a restart unless rewritten when shown; it asked itself which notebook and chose General.

- **Run on:** 14 November 2026, 8a707aa (#313; before #314, so the pages were opened with browser.openPage through
  the bridge). Local addresses off. Chip pressed with three tabs open.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** five approval cards (tabs 5.4 s; three page reads 10.9–12.4 s; notes list 18.3 s); first write failed at
  about 35.6 s; note written 50.7 s; Keep bar 59.2 s; end 64.5 s.
- **What appeared:** "Compare: battery packs" in Notes › Comparisons, one table, column headers linked to the pages,
  rows Maker, Capacity, Voltage, Weight, Lead time, Price, Warranty, What is included, Delivery. All 21 values correct,
  each linked to its words on the page. Three good lines on which suits whom.
- **Weak:**
  1. Over four times the fifteen-second bar.
  2. The colon in "Compare: …" failed the first write on Windows and left an empty file `notes/Comparisons/Compare`,
     which the change bar counts ("2 pages").
  3. Two rows ("What is included", "Delivery") are "not stated" for every page: they come from the prompt's examples.
  4. Links point at the session's served address (127.0.0.1 port and token), which likely breaks after a restart.
  5. Five approval cards for one press; the recap in the panel shows raw table pipes.
- **Earlier, round 4 (3048598):** blocked, no way to open a seeded page and local addresses refused; fixed by #313/#314.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round5\`.

## Files: Tidy this folder (local, after #288)

- **Run on:** 14 November 2026, 62b8354 (main with #288, #289, #290, plus the seed). The suggestion read "Tidy a
  folder…", not "Tidy this folder", so the ask was typed with Downloads open.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** first approval card 5.5 s, a second at 11.3 s; moves at about 29 s; turn done 36.3 s; Keep bar 37.3 s.
- **What appeared:** 60 files in, 60 out, none renamed or deleted. Five top folders (Documents, Images, Finance,
  Kestrel P2, Installers), twelve with subfolders. Keep bar read "108 changes · Files · 108 files".
- **Weak:**
  1. In Review changes the files moved first and were marked after; nothing was dashed before the move.
  2. Two approval cards just to list files ("which notes and files there are", then again for Downloads).
  3. Counts disagree: the reply said 59 files, the step said 50, the bar said 108.
  4. Twelve folders in all (the bar is six or seven).
  5. Undo took about 38 s, left the 6 zips in Installers\ and all 12 new folders behind (11 empty). Nothing lost.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round2\`.

## Sheets: What stands out? (local; chart to follow)

- **Run on:** 14 November 2026, 65bb3a5 (#320). Sheets › Sales 2025, first chip, no approval cards.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** read 5.7 s, write 14.8 s, cells and chart drawn dashed together at 22.7 s, end 28.0 s.
- **What appeared:** Total and Average rows as `=SUM(B2:B13)` and `=AVERAGE(B2:B13)` (and for C and D); a Stands out
  column with only April ("0.27× the average") and September ("1.73× the average"); a column chart of units; three
  lines naming B5, B10, B15 and the rest; every original cell unchanged; Keep, Discard, Try another.
- **Meets the bar:** content yes; time 22.7 s, over fifteen.
- **Weak, minor:** Returns average shows 3.3333333333 (no number format on new rows); the bar says "2 sheets" for one
  workbook (the chart file); "0.27× the average" is terser than "low: 41 units"; the chart sits below the grid at 1440
  wide, not beside it.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round11\`.

## Code: a failing test in Glance (local)

- **Run on:** 14 November 2026, a99e095 (#319, the seed's project now Node). Test command "npm test" accepted from
  the suggestion; Run tests failed on "pack temperature" (105 !== 25); "Find the cause" in Glance.
- **Model:** Sonnet 5.5 through Claude Code.
- **Time:** files read 5.8 s; edit 11.9 s; tests run again and passing about 14.7 s; Keep bar 18.3 s; end 23.7 s; no
  approval cards.
- **What appeared:** one line changed in telemetry.js (`+ 40` to `- 40`), the test untouched, "Passed · run by
  Mobius", three sentences on what was wrong, Keep, Discard and Try another.
- **Meets the bar:** yes, at 14.7 s.
- **Weak:** the explanation is given twice (before and after the fix); the person's turn shows the raw internal prompt
  ("…fix it with files.edit, run code.test…"). Glance's card may read "error: |-" for node output until #327.
- **Earlier:** round 7 first stopped because the PC has no Python with pytest; the seed moved to `node --test`.
- **Screenshot:** Andrew's PC, `mobius-moments-shots\round7\code\`.

## Comments (shell, #290)

- **Run on:** 14 November 2026, 62b8354.
- **Sheets, B5 "Why is April so low?":** first step 5.6 s, change bar 20.3 s, done 24.4 s. A good answer (volume not
  price, maybe a typo for 141, September the other outlier), the sheet untouched. Keep resolved the thread with a tick.
  Weak: the reply shows raw markdown in the thread, including `[April units are 41](trust:yours "...")` links; a pure
  answer still made "1 change in Files" to review (the comment's own .comments file).
- **Docs, first paragraph of the brief, "Make this paragraph shorter":** first step 7.5 s, Keep at 35.9 s, done 40.5 s.
  The first edit failed on line breaks inside the paragraph, so it rewrote the whole file: the file diff is just that
  paragraph (about 140 to 85 words, good text), but the review shows the whole document struck through as one change.
  The panel narrates the failure; the thread reply shows raw markdown. Keep resolved the thread.

## Settings: a model on this computer (shell, #290)

- **Run on:** 14 November 2026, 62b8354. No Ollama or LM Studio; Mobius already lists Qwen3.5-9B (Q4, about 6 GB,
  rated a GPU fit) with its CUDA engine installed.
- **Cloud first:** "Summarise the build brief" on Sonnet 5.5, first words 2.2 s, done 18.1 s; a good summary, but the
  schedule table came out as raw pipes, and it closed on a confusing note that the budget lines do not sum to 92,000.
- **Switch to Qwen mid-chat:** the engine failed both tries (CUDA host buffer, then cudaMalloc out of memory). The PC
  had only 7 GB commit free, with the Realtek audio service holding 7.7 GB. Weak: the chip stayed on "Sonnet 5.5" and
  no error showed; a person would never learn the switch failed. Run again after a reboot.

## Leaving Plan my day for Mail (#323, #328)

- **Round 8 (75dc9eb):** Plan my day on Home no longer opens a split; it goes to Calendar with the conversation in the
  Mobius panel. Mail from the sidebar, the launcher or after clicking in Calendar opens alone with Mobius in its panel.
- **Weak:** the panel still holds the Plan my day conversation with its Keep bar, so Mail's "Triage the unread" action
  is hidden until Keep or a New chat. Plan my day also marked one mail read by reading it (41 to 40 unread).

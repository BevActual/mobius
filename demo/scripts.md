# Demo scripts

How to run the moments from [the demo plan](../docs/archive/demo-plan.md) that have not yet been run with a real
model, on the seeded workspace in `demo/workspace/`. Each says what to open, what to press or type, what a good result
looks like, and whether what it needs is on main. Timings and results go in [results.md](results.md), which also
holds how the earlier moments (Home, Mail, Calendar, Notes, Docs, Slides, Browser, Files, Sheets, Code) are run.

## Photo: Make these match

- **Start:** Photo, album **Jasmund cliffs** (ten photos from one walk, uneven in light and colour). No photo open, so the whole album shows.
- **Ask:** press **Make these match** (shown in an open album of more than one photo, with no photo open).
- **Good result:** one `photos.edit` call on the album, its amounts chosen from the numbered picture of all ten that goes with the chip. All ten photos change together and their tiles show the dashed mark until kept; no single photo is attached. Open one and hold Show original (M): the photo as shot comes back while held, so nothing was lost. Keep takes all ten.
- **On main:** `photos.edit` (an album or a list, up to 200 photos) and the chip, yes. Show original moves to the library's hold (#403) in Photo's next change.
- **Note:** the album has ten photos, not twelve as the plan says.

## Design: three takes

- **Start:** Design, **Kestrel app / Charging screen**: one rough phone frame, "Charging", with a title, a ring and a few layers, and two colour styles (Primary, Ink).
- **Ask:** type: `Give me three takes on this: add three new frames to the right of Charging, each a different layout of the same screen, using the design's colour styles. Leave Charging as it is and give new layers new ids.`
- **Good result:** one `design.edit` that adds three frames beside Charging, each dashed until kept. Keep one and discard two: the kept frame is ordinary layers that can be selected and moved.
- **On main:** `design.edit` (adds frames and layers, each waiting for Keep), yes. A "Three takes" chip is not yet. Write down whether Keep and Discard can take one frame and leave the others; if they only take the whole change, that is for Design's round.

## Database: a question in plain words

- **Start:** Database, **Customers** (tables `customers` and `orders`, eighteen customers).
- **Ask:** press **Ask about it…** and finish the line: `which customers haven't ordered since June?`
- **Good result:** one `db.query`, with the SQL shown where it can be read, and four rows: Ashby Buses (last order 9 May 2026), Fenwick Farms (2 May), Peregrine Vans (16 March) and Tern Medical (27 May). Nothing is changed.
- **On main:** `db.query`, yes. Write down whether the SQL shows in the reply; the moment needs it seen.

## Research: one hard question

- **Start:** Research, with no report open. Needs the live web.
- **Ask:** type in Research's own question box, with **Quick**: `Should a small electric van fleet choose LFP or NMC batteries in 2026?` It makes the report first, so it fills in view.
- **Good result:** pages are searched and read in view, and a report builds in Research with every claim linked to a page it read (every source in the list was read with `web.read`). Then **Check the claims** reads the sources again.
- **On main:** `web.search`, `web.read` and the browser tools, yes. Time it: the plan says it needs checking for pace.

## Rewind (the Builder's moment)

- **Start:** after the other moments, on the same workspace, so several apps have kept changes.
- **Do:** Activity, press **Rewind to here** on the earliest line, and confirm.
- **Good result:** every app goes back at once, to how it was right after that turn.
- **On main:** yes. The Builder owns this moment; send them anything that does not go back.

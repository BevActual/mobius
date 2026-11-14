# Build brief

So basically the P2 build runs the week of the 23rd at Northfield, and what we are trying to do, at a high level, is
get the second prototype, which is the P2, running on the sled by the end of that week, with the battery packs fitted
and also the motor tested at full load, which we have never actually done on a full vehicle before, so it is quite a
big deal for the programme overall and I think it is worth everyone understanding why. This document is meant to pull
together everything we know so far, although some of it is still moving, and I have tried to flag where that is the
case, but if something here disagrees with what you have heard in a meeting then please assume the meeting is more up
to date and tell me so I can fix it here.

## Background

The P1 taught us a lot, and most of it the hard way. We built one chassis, we fitted borrowed packs that were not
really the right size for it, and we never got the motor above about sixty percent load because the cooling was not
up to it and, to be fair, nobody was very keen to find out what happened at a hundred. The lessons deck from P1 goes
into all of that in much more detail than I will here, but the short version is that we learned that the packs, the
motor and the cooling have to be designed together, not one after the other, and that a test week only works if the
parts are actually there on the Monday rather than turning up in dribs and drabs through the week, which is what
happened last time and cost us, by my count, about two and a half days of the five.

So for P2 the idea, and this has been the idea since the kickoff really, is to do it properly: two chassis rather than
one, so that if one has a problem we still have a car to test, the right packs from the start, the motor on the newer
controller firmware, and a proper plan for the week that everyone has seen in advance and agreed to, or at least not
objected to.

## Goal

Two running Kestrel P2 chassis on the sled by the end of the build week, packs fitted and the motor tested at full
load. Also we want to get some data on thermal behaviour if there is time, but that is more of a nice to have and
probably will not happen, to be honest, unless everything else goes perfectly, which in my experience it does not.

To be a bit more specific about what "done" means, because people have asked: both chassis power on, both drive onto
the sled under their own power, and at least one completes the full-load run of ten minutes at 150 kW without the
pack temperature going over 55 degrees. If we get that, the week is a success. If we only get one chassis running,
that is still useful but we will need a second week, which is about 18,000 GBP we have not budgeted for.

## Packs

Eight 60 kWh packs from Veltro, six weeks from order, at 6,000 GBP each with delivery to Northfield included, so
48,000 GBP for the eight. The deposit, which is 20 percent, has to be paid by the end of this week or the slot goes,
and if the slot goes then the next one is, as far as we know, not until the new year, which would obviously be a
disaster for the build week.

There was some talk of Ardent as a second source, which might be cheaper, their quote was 5,800 GBP a pack for a 58 kWh
pack, but it is a week slower to deliver and we have not tested their cells at all, so for now it is Veltro, although
that could change if the price moves, which it might, because Veltro have been a bit vague about whether the price is
fixed past this week. I have also had a look at a third option, Kore, who do a 62 kWh pack, but they could not give us
a delivery date at all, so I have not taken that any further.

There is also an open question, which keeps coming up, about whether we want eight packs or ten, the extra two being
spares. Spares would cost another 12,000 GBP and the budget really does not have that in it right now. My view is
eight now and top up after the build week if we need to, but I know not everyone agrees.

## Motor

The Axion 150 kW, with the controller on firmware 2.4, which is the version that is supposed to fix the torque
dropout we saw on P1 at around 4,000 rpm. Sam runs the bench test before the build week. If the bench run slips again,
and it has slipped twice already, which is not great, then the whole test order for the week needs re-planning,
because the full-load run depends on the bench numbers, and that would push the crash test, which pushes everything
else, and the crash test slot at Northfield is not easy to move either.

Sam is also going to look at the torque curves from the last bench run, the one that actually happened, and send a
short note on whether we are happy with the 2.4 behaviour or whether we need to ask Axion for another build.

## Cooling

This is the bit that went worst on P1, so it is worth a paragraph. For P2 the cooling loop is sized for the full 150
kW, the radiator is about 30 percent bigger, and there is a second pump. Dana's team have built the loom for the
pumps and the sensors, apart from the main wiring loom, which is a separate thing and still waiting on a supplier, see
risks below. We will not know if the cooling is really enough until the full-load run, which is sort of the point of
the week.

## Schedule

| Day | What | Who |
| --- | --- | --- |
| Day 1 | Unload and inspect packs | Dana |
| Day 2 | Fit packs, first power-on | Priya, Sam |
| Day 3 | Motor bench test | Sam |
| Day 4 | Sled runs | Dana, Sam |
| Day 5 | Full-load test, wrap-up | Everyone |

The schedule is tight, there is no slack in it at all really, and if any one day slips then day five gets squeezed,
which is the day that matters most, so the plan if we slip is to drop the thermal data first, then the second sled
run, and keep the full-load test no matter what.

## Budget

The budget for the build week is 92,000 GBP all in. The packs are 48,000 of that, which is most of it. The sled time at
Northfield is 9,500, travel and hotels about 6,000, the motor bench and Axion's support 11,000, and the rest is parts,
the jigs, the loom and a contingency of about 8,000 which, given everything above, I would not want to spend before
we get there. Priya has signed this off, with the condition that anything over the contingency comes back to her
first.

## Risks

- Packs late. Veltro have been reliable so far, but six weeks is six weeks, and we have no second source tested.
- Bench run slips again. It has already moved twice.
- Wiring loom. The supplier is still not confirmed, and without the loom nothing powers on.
- Weather at Northfield, since the sled is outside and they will not run it in heavy rain.
- Budget. The packs alone are most of it, and a second week would not be covered.

## Open questions

- Is it eight or ten packs with the spares?
- Who drives the van to Northfield, and does it need a second driver for the packs?
- Do we keep the thermal data run if day five is squeezed, or drop it?
- Who signs off the full-load run as safe to start?

## What happens next

Pay the Veltro deposit this week. Confirm the loom supplier. Get the bench run done and the test order re-planned if
it moves. Send the parts list and the brake test plan to Priya by the end of the week. Book the van. And then, really,
just get everyone to Northfield on day one with the parts already there, which, if P1 taught us anything, is most of
the battle.

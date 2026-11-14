# Mobius: where it stands, how people will react, where to share it

> Copied from the claude.ai page of the same name on 14 November 2026, when the project moved to the repo. Links point at the repo copies.

Nov 12, 2026

## Short answer

The direction is right and still open, but the window is narrowing: in 2026 ChatGPT, Claude and Google all shipped agents that work across your mail, calendar and files. They do it by plugging into apps you already use. Mobius is the only one that puts the apps themselves in one place, open source, with any model. That is a real difference, but only if the core apps are good enough to switch to.

I agree with the earlier take, with one change: the bar is not five or six polished apps, it is **one workflow people can't get elsewhere**, built on Mail, Calendar, Tasks, Notes and Docs with real accounts. Ship that signed, show it in a 60-second video, and share it with open-source and local-AI communities first. Do not share widely until the installer is signed, the first run works without help, and Mail and Calendar connect to real accounts.

What I checked: the repo's README, roadmap and docs on main (12 Nov 2026), the market research note in PR #65, and fresh searches on rivals. I have not used the app hands-on for this, so the state section relies on the docs and thread history.

## Where Mobius stands against rivals

Today Mobius wins on the idea, openness and safety model, and loses on depth and trust. At a very high level it would be the open, own-your-files alternative to the big agents, which is a place none of them can take.

| Rival type | Examples (2026) | What they do better today | Where Mobius is different |
| --- | --- | --- | --- |
| Big chat assistants that now act | [ChatGPT Work](https://www.digitalapplied.com/blog/chatgpt-work-openai-agent-launch-2026) (Jul 2026, 1,400+ plugins, Mac and Windows); [Claude Cowork](https://tomorrow-solutions.com/en/blog/claude-chat-cowork-unified-it-november-16/) (merging into Claude, Nov 2026); Google Gemini Agent for Workspace (Oct 2026, from headlines) | Strong models, huge connector lists, millions of users, run for hours | They reach into your apps from outside. Mobius is the apps, so every change shows in place with Keep, Discard and Rewind. Any model, files stay on your PC |
| Open agents | [Hermes Desktop](https://decrypt.co/369952/hermes-ai-agent-official-app-terminal?amp=1) (Jun 2026, MIT, Mac/Windows/Linux, Telegram/Slack/email, sub-agents) | Mature agent, big community, messaging channels, subagents, Mac and Linux | Hermes has an agent and no apps. Mobius has apps and an agent, plus a much more polished look |
| Single apps with AI | Notion, Superhuman, Cursor, Arc/Dia | Each is far deeper in its one job | Mobius connects them; none of these sees your whole day |
| Shared workspaces | Cua Spaces (Oct 2026, in our [market notes](https://github.com/BevActual/mobius/pull/65)) | Remote desktops for people and agents | Mobius wins on review and undo, not on remote machines |

**Mobius now.** About 98,000 lines of Rust and TypeScript, 25 apps, three approval modes, Keep/Discard/Rewind everywhere, a dozen model gateways including local models, MIT licence. But: v0.1.0 is an unpublished, unsigned draft; Windows only; Mail needs app passwords; Google and Microsoft calendar sign-in isn't built; the agent hasn't been proven on long real tasks; and outside users are close to zero. Against rivals it is wide and promising, not yet something a normal person switches to.

**Mobius at a very high level.** If Mail, Calendar, Tasks, Notes and Docs are good enough to use every day with real accounts, and the agent reliably carries work between them, Mobius becomes "the open-source, local, any-model version of what ChatGPT Work and Cowork promise", with the advantage that you can see and undo every change inside the real app. That is a believable niche with a loud community behind it. It is unlikely to beat Google or Microsoft for office workers whose employer picks their tools; the realistic audience is individuals and small teams who choose their own.

**Biggest risk.** Not the rivals copying you, but breadth: 25 apps each 70% done reads as a demo. One app that is worse than what someone already uses (usually Mail) is enough for them to leave.

## How people will react

Expect a split: a small group will love it immediately, and most people will be sceptical by default. That is normal for this kind of app, and the scepticism tells you what to fix before sharing.

**Who will like it**

- Local-AI and open-source fans: any model, llama.cpp built in, files as Markdown and CSV, MIT. This is the warmest audience.
- People who already pay for ChatGPT or Claude and want it to act on their own stuff without handing everything to one company.
- Design-minded users who notice the Apple-style polish. Good screenshots will get attention on their own.
- Hermes users who want an agent with real apps around it.

**What sceptics will say (and what answers it)**

| Objection | Why they'll say it | What answers it |
| --- | --- | --- |
| "Jack of all trades, master of none" | 25 apps from one person sounds impossible to do well | Lead with one workflow, not 25 apps. Say plainly which apps are solid and which are early |
| "I'm not moving my email" | Mail is the hardest app to switch; Gmail and Outlook are good | Work on top of existing accounts (IMAP now, Google/Microsoft sign-in next). Never require leaving Gmail |
| "Is this safe? An agent in my mail?" | Prompt injection and agents sending things are known fears | Show that sending, paying and deleting always ask, and Keep/Discard/Rewind. Publish a short security page |
| "Unsigned exe from a new repo" | Windows SmartScreen warns; people suspect malware | Finish SignPath signing before any big share |
| "AI-built slop" | The repo is developed with AI agents, and readers will spot it | Be open about it and show quality: tests, CI, docs, a real changelog. Answer comments yourself |
| "Solo dev, will this be abandoned?" | Many such projects stall | A public roadmap, steady releases, and visible issue replies |
| "Why not ChatGPT Work or Cowork?" | They are free or bundled and backed by big labs | Open source, local files, any model including local, see and undo every change |
| "Windows only" | Many early adopters on HN and design circles use Macs | Say macOS is coming; consider getting the Mac build out before the biggest launch |

**What it needs before sharing lands well**

1. A signed installer that a stranger can run, with a first run that gets them to something useful in under five minutes.
2. Mail and Calendar connected to real accounts, and no crash or data loss in a week of daily use by you.
3. One hero workflow that works every time (for example: "read today's mail, turn the asks into tasks, block time on the calendar, draft the replies", all as reviewable changes).
4. A 60–90 second video of that workflow, uncut, plus honest labels on which apps are early.

## Where and how to share it

You're right that being findable isn't enough: share in three waves, smallest and friendliest first, so the big launch happens once the rough edges are found. You only get one good first impression on Hacker News and Product Hunt.

**Wave 1: friendly testers (when the signed installer works).** 10–30 people who will tell you what breaks. Post in Hermes/Nous Discord, r/LocalLLaMA's tool threads, and to people you know. Ask for a 15-minute call or a written note, not stars.

**Wave 2: niche communities (after fixing what wave 1 found).**

| Where | Why it fits | What to post |
| --- | --- | --- |
| r/LocalLLaMA | Loves open, local, any-model tools | "Open-source workspace where a local model works across Mail, Calendar, Notes"; video + GitHub link |
| r/selfhosted, r/opensource | Values owning your files, MIT | Focus on Markdown/CSV files on your PC, no account needed |
| r/windows, r/Windows11 | Few polished Windows-first apps exist | Screenshots; the design is the hook |
| Hermes / Nous community | Same agent ideas, users want apps | How Mobius relates to Hermes, credit it openly |
| X / Bluesky (AI and design circles) | Short videos travel | One 30-second clip per app or workflow, over several weeks |
| dev.to or your own blog | Long-form story | "Building 25 apps with one agent as a solo dev", including what went wrong |

**Wave 3: the big launch (after wave 2, ideally with macOS).**

1. **Show HN.** It [fits the rules](https://news.ycombinator.com/showhn.html): something people can download and try, no signup. Title like "Show HN: Mobius – open-source AI workspace, your apps and one agent (Windows)". Post a weekday morning US time, stay in the comments all day, answer the hard questions plainly. Don't ask anyone to upvote.
2. **Product Hunt** a week or two later, with the video, gallery and an honest "early preview" note. Solo launches with no audience often get [a handful of votes](https://www.indiehackers.com/post/i-launched-on-product-hunt-got-4-votes-and-learned-more-than-any-course-could-teach-me-11d7ac7489), so treat it as a bonus, not the main event.
3. **Newsletters and YouTubers** who cover AI tools and open-source apps, after the HN post gives you something to point at.

**What to show everywhere:** the uncut hero workflow video first, then the app gallery, then the safety rules. Lead with "what it does for you", not "25 apps". The README is already a strong landing page; add the video at the top and a line on which apps are stable.

**What state it should be in first:** signed v0.1.x on Releases, a five-minute first run, Mail and Calendar on real accounts, an issues template and a short FAQ that answers the objections table above.

## Next steps

These are the moves that most raise the odds of a good launch, in order. Only the first needs you.

- [ ] Finish SignPath signing and publish v0.1.x (Andrew: apply and add the two secrets)
- [ ] Name the "great" tier: Mail, Calendar, Tasks, Notes, Docs. Label every other app "early" in the README
- [ ] Google and Microsoft calendar and mail sign-in
- [ ] Pick and harden one hero workflow across Mail, Tasks and Calendar; run it daily for a week
- [ ] Guided first run that ends with that workflow done on the person's own data
- [ ] Record the 60–90 second video and add it to the top of the README
- [ ] Write a short FAQ and security page from the objections table
- [ ] Wave 1 with 10–30 testers, then waves 2 and 3

## Sources

- Repo README, roadmap and docs on main, read 12 Nov 2026: [BevActual/mobius](https://github.com/BevActual/mobius)
- Market research note: [PR #65](https://github.com/BevActual/mobius/pull/65)
- [ChatGPT Work launch (Digital Applied)](https://www.digitalapplied.com/blog/chatgpt-work-openai-agent-launch-2026)
- [Claude chat and Cowork merge (Tomorrow Solutions)](https://tomorrow-solutions.com/en/blog/claude-chat-cowork-unified-it-november-16/)
- [Hermes Desktop release (Decrypt)](https://decrypt.co/369952/hermes-ai-agent-official-app-terminal?amp=1)
- [Show HN rules](https://news.ycombinator.com/showhn.html)
- [Solo Product Hunt launch (Indie Hackers)](https://www.indiehackers.com/post/i-launched-on-product-hunt-got-4-votes-and-learned-more-than-any-course-could-teach-me-11d7ac7489)
- Google Gemini Agent: news headlines only, the source page could not be opened

# Market research, November 2026

What the agent market looked like when Mobius took its current shape (8 November 2026), and what it meant for Mobius.
Kept for reference; the [roadmap](../roadmap.md) says what is planned.

The market is converging on what Mobius already does: memory that lasts, controls you can see, and people and agents in
one space. Mobius stands out on its review-and-undo loop (Keep, Discard, Try another, Rewind), which none of these
products feature.

| Source | Finding | What it means for Mobius |
| --- | --- | --- |
| [Hermes Agent news, Nov 2026](https://blog.mean.ceo/hermes-agent-news-november-2026/) | Hermes ships a desktop app and a Windows installer with no WSL. Each solved task is saved as a Markdown skill, and SOUL.md holds hard rules. | Mobius competes with its own reference on the desktop. Skills and a rules file are expected, not extras. |
| [Hermes v0.21 "Pantheon"](https://digg.com/ai/3wdiuxfn) | Bots mode, agent-to-agent messaging, multi-gateway connections and subagent steering. Users complain of desktop timeouts and too-fast releases. | Outside channels and subagents are the biggest gaps against Hermes. Stability is a place to beat it. |
| [Vellum, best AI coworkers (Jul 2026)](https://www.vellum.ai/md/blog/best-ai-coworkers) | Scoring weights memory 30%, integrations 25% and credential security 20%. Common gaps: context resets every session, no proactive behaviour. | Mobius already has memory, schedules and the system secret store. Say so, and add vault sign-in for sites. |
| [HatchWorks, agent UX patterns (Mar 2026)](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/) | Autonomy should go Suggest, Draft, Execute, starting low. Risky work should run Plan, Validate, Execute, with a receipt. Memory should be visible and editable. | Mobius has plans, modes and per-app access. It lacks a receipt at the end of a run. |
| [Cua Spaces (Oct 2026)](https://runtimewire.com/article/cua-spaces-teams-pro-shared-desktops-ai-agents) | A shared desktop where people and agents work side by side, on macOS, Linux and Windows. | "Shared workspace" is becoming a category. Mobius should win on review and undo, not on remote desktops. |

## Ideas from it not yet on the roadmap

- **A run receipt.** When a run ends, one card lists what Mobius read, changed, asked about and couldn't do, with Keep
  all and Undo. The pieces exist in Review, turn history and Activity.
- **Vault sign-in for the Browser.** A site's password is filled from the system secret store and never reaches the
  model; each use is approved once or for the task.
- **Outside channels for Agents.** Reach Mobius from one channel first (for example Telegram or email), using the
  approvals Mobius already has, sent back as yes/no questions. See the Messages app idea on the roadmap.

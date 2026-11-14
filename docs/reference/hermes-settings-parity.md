# Hermes settings parity

Source of truth for "what Hermes settings has that Mobius does not yet". Hermes is at
`%LOCALAPPDATA%/hermes/hermes-agent/apps/desktop/src/app/settings` (manifest: `settings-manifest.ts`,
subpages: `subpages.ts`, `config-subpages.ts`, `other-subpages.ts`).

Rule: a Mobius setting exists only if it changes something real. "Needs X" means the setting is blocked on a
capability Mobius does not have yet, not that it is skipped for being hard. Status: **done**, **next** (nothing
blocks it), **needs X**, **n/a** (Hermes-specific, no Mobius meaning).

## Appearance (Hermes: General, Theme, Typography, Window layout, Chat display, Pet)
| Hermes row | Mobius | Status |
|---|---|---|
| theme | Theme | done |
| uiScale | Interface zoom | done |
| chatTextScale | Conversation text size | done |
| chatFont | Conversation font (system/serif/mono) | done |
| textDirection | Text direction | done |
| toolView / hideCodeDiffs | Tool steps (show / hide finished) | done |
| sessionDensity | List density | done |
| resumeLastSession | Reopen the last conversation | done |
| fileBrowser (open at start) | Show the tab list at start | done |
| interfaceMode (simple/advanced) | - | next |
| tabStrip, appActions (layout of title bar) | - | next (needs a layout decision) |
| userBubble opacity, translucency, backdrop | - | needs glass layer (design rule: glass only on the top layer) |
| minimizeToTray | - | next |
| composerPopout | - | needs a floating composer |
| language | - | needs translation of the UI |
| introSplash, tips, tours, modelPricing, reactions, vibeHearts, embeds | - | tips/tours need onboarding; pricing needs usage accounting; rest n/a or later |
| reasoningCollapsed | - | needs reasoning stream in the provider |
| hideThreadTimeline | - | needs a thread timeline |
| terminalFont | - | needs a terminal app |
| pet | - | n/a |

## Model (Hermes: Main, Fallbacks, Auxiliary, Delegation, MoA)
| Hermes row | Mobius | Status |
|---|---|---|
| model, provider, base URL, key | Model form | done |
| local models | This computer | done (beyond Hermes) |
| model_context_length | Context size (local models) | done for local models; cloud models take it from the service |
| reasoning effort, service tier | - | needs provider support |
| fallback providers | Second model (Model > Server) | done (one fallback; switches on busy/down/unreachable, never hides a rejected key) |
| auxiliary models (title, compression, vision...) | - | needs those features |
| delegation / subagents, MoA | - | needs sub-agents |
| custom endpoints list | one endpoint plus one fallback | done in the Tauri shell: Settings → Model → Saved servers (named, keys in the secret store) |
| providers / keys page (many providers) | Settings → Providers → API keys (Tauri shell): 14 providers, one key each in the system secret store, model list from the provider, "Use" switches the agent keeping its instructions and second model; removing a key also stops the agent sending it | done (not copied: per-provider advanced overrides such as region; the address of a listed provider cannot be changed) |
| subscription sign-in: Claude through Claude Code (Hermes plugin `claude-subscription-directsdk`) | Settings → Providers → With your subscription: status from `claude auth status`, Sign in opens Claude Code's own sign-in, Use picks a model. Crate `mobius-claude` (Rust port, MIT, attributed): each model call is one `claude -p` run with its tools/settings/memory off, Mobius tools listed by an inert MCP server, a loopback relay admitting exactly one upstream request; Mobius runs the tools under its own approvals and never sees the sign-in. Live-tested on the owner's plan | done (not copied: prompt-cache hygiene, request gzip, HTTPS proxy in the relay; native turns with signed thinking are kept in memory only, so after a restart history replays as plain text). Still to do: Nous Portal, Copilot, xAI, Qwen |
| subscription sign-in: ChatGPT plan (Hermes `auth_codex.py`, `agent/transports/codex.py`) | Settings → Providers → With your subscription → ChatGPT: OpenAI's device sign-in (code shown, Copy, Open the sign-in page, Cancel, Sign out); tokens in the system secret store only, refreshed 5 minutes before they run out with a rotated refresh token kept; the agent speaks the Responses API to chatgpt.com/backend-api/codex with the account header from the token (`mobius-agent/src/responses.rs`). Uses the Codex CLI's public client id, as Hermes does | done (not live-tested on a real plan yet) |

## Chat (Hermes: Behavior, Attachments)
| Hermes row | Mobius | Status |
|---|---|---|
| personality | Instructions (free text, Model) | done as free text; presets are next |
| timezone | - | next (sent to the model) |
| show reasoning | - | needs reasoning stream |
| image input mode, attachment size | - | needs attachments |

## Workspace (Projects, Shell, Files) - needs code/terminal apps (not built)

## Safety (Approvals, Privacy, Checkpoints)
| Hermes row | Mobius | Status |
|---|---|---|
| approvals: grants list, revoke | Approvals | done |
| command allowlist | - | needs shell tool |
| approval mode (manual / smart / off) | Permission: Ask each time / Review changes / Apply changes / Auto | done. Smart: your model reviews each question first (approve = this one use only, deny = asked, once only, unsure/failed = asked). Off still honours blocks. Hermes extras not copied: denial circuit breaker, separate reviewer model, custom reviewer rules |
| privacy (redaction, secrets) | partly (activity never has arguments) | next |
| checkpoints / rollback | - | needs file tools |

## Browser
| Hermes row | Mobius | Status |
|---|---|---|
| allowed sites | Sites | done |
| history, bookmarks | History, Bookmarks | done (beyond Hermes) |
| use real profile | - | next (import cookies is risky; decide) |
| private URLs / network rules | Network > Local addresses | done (off by default; limits the agent, not the person) |

## Memory (Persistent, Context) - needs memory and context compression in the agent

## Voice (Conversation, Transcription, Speech) - needs audio in/out

## Keybinds (Shortcuts, HUD gesture, Screen capture)
| Hermes row | Mobius | Status |
|---|---|---|
| shortcut list | Shortcuts | done |
| rebind shortcuts | click a key field and press the keys; clear (x) / Reset / Reset all; clashes and editing keys refused; works inside web pages too | done (not copied: per-category folding, search box, plugin-contributed actions) |
| quick entry (global shortcut) | Quick entry from anywhere (off until chosen; says when another program has the keys) | done |
| screen capture attach | - | needs attachments |

## Notifications (Alerts, Sounds)
| Hermes row | Mobius | Status |
|---|---|---|
| per-kind alerts (needs you, finished, download done) | Alerts | done |
| mute sounds | Sounds | done |
| enable-all master switch, completion sound choice | - | next (needs a sound asset) |

## Sessions (Archived, Default directory)
| Hermes row | Mobius | Status |
|---|---|---|
| saved list, delete | Conversations | done |
| archive / auto-archive | Archive button on each session, Archived group (Tauri shell); auto-archive not built | done (manual) |
| default directory | - | needs projects |

## Advanced (Desktop, Runtime, Tools, Terminal, Output)
| Hermes row | Mobius | Status |
|---|---|---|
| max turns | Steps per request | done |
| API retries | - | next |
| keep awake while working | Desktop | done |
| disable F12 / devtools | - | next |
| toolsets / tool enforcement | - | next (enable/disable tools; tool registry not built) |
| tool output limits | - | next |

## Gateway, Vault, Plugins, Connections, Billing
Hermes-specific services (remote gateway, credential vault, plugin marketplace, billing). Mobius equivalents come
with their own features: remote hosting (headless server), a secrets store (`secrets.read` is already a floor), MCP
tools (one registry, both ways). Not started.

## About
| Hermes row | Mobius | Status |
|---|---|---|
| version, runtime info, open data folder | About | done (opens the folder in both shells) |
| updates | - | needs a release channel |
| uninstall | Settings → Privacy → Remove my data (asks twice; empties the data folder, including Notes and the workspace, and every saved key, then closes; Tauri shell) | done |

## Order of work
1. Appearance (done in this pass).
2. Notifications and Advanced > Desktop (done; devtools switch still to do).
3. Chat behaviour (personality presets, timezone) and Model extras (context length, fallbacks, endpoint presets).
4. Safety (approval mode, privacy) and Browser network rules.
5. Keybinds (rebinding, quick entry), Sessions archive, About uninstall.

## Message box and sidebars (this pass)
| Hermes | Mobius | Status |
|---|---|---|
| Add context (page, file) | message box: This page / A file, chips, up to 5, marked as data | done |
| Model switcher | lists the server's models; choosing one changes the next message | done |
| Reasoning effort | Default/Low/Medium/High; sent only when chosen; never to the reviewer; also in Settings → Model | done |
| Voice dictation | records, sends to the server's speech endpoint, inserts the words; Esc cancels; says plainly when the server has none; model name in Settings → Model | done |
| Send / stop | one button; Stop while working (no separate pause) | done |
| Sessions and Agents sidebar | Agent app list switches Sessions / Agents (called Bots before); agents have a name, added instructions and optional model; sessions are grouped under their bot; removing a bot removes its sessions after asking | done |
| Bot per platform (gateway groups, filters, profile switcher) | - | not copied: Mobius has no messaging platforms or profiles yet |
| Floating / auto-hide / attached sidebars, resizable | Appearance → Layout | done |

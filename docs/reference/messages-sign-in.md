# Messages sign-in: registering Mobius

Messages signs in to each chat service as the person, through the service's official API. Some services only allow
that once Mobius is registered with them, and only the project's owner can register it. This page lists what Andrew
does for each service and what he hands back to the Builder.

Andrew decided on 18 November 2026 to build official logins now: Slack, Telegram, Matrix, and Discord as a bot only.
Signal comes later, as a linked device. Discord and WhatsApp user logins, the way Beeper does them, are a decision for
after launch, because they break those services' terms.

Checked on 18 November 2026.

## Slack

Mobius signs in with OAuth and PKCE, which Slack has offered to desktop apps since March 2026. It needs no client
secret. The sign-in comes back to a fixed address on the person's computer, `http://localhost:47615/slack`, because
Slack only returns to an address registered with it.

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and choose **Create New App**, then **From scratch**. Name it
   Mobius and pick any workspace you're in. That workspace is only where the app is managed: people in other
   workspaces can still sign in, once distribution is on (step 5).
2. Under **OAuth & Permissions**:
   - Add the redirect URL `http://localhost:47615/slack`, and save.
   - Under **User Token Scopes**, add: `channels:read`, `channels:history`, `channels:write`, `groups:read`,
     `groups:history`, `groups:write`, `im:read`, `im:history`, `im:write`, `mpim:read`, `mpim:history`, `mpim:write`,
     `users:read`, `chat:write`. Add no bot scopes, because a desktop sign-in can't have them.
   - Turn on **PKCE**. This can't be undone without asking Slack's support. It marks the app as a public client,
     which is what Mobius is.
3. Optional: under **Basic Information**, add the Mobius mark as the app icon.
4. Under **Basic Information**, copy the **Client ID**. It is not a secret.
5. Under **Manage Distribution**, turn on public distribution, so people outside your workspace can sign in. This needs
   no Slack review unless you list the app in the Slack Marketplace.

**Hand back:** the Client ID. The Builder builds it into Mobius as `MOBIUS_SLACK_CLIENT_ID`, and Launch adds it to the
release build.

What it unlocks: Settings › Messages › **Sign in to Slack**, then that workspace's channels, direct messages, groups and
threads in Messages.

What to expect: Slack hands a PKCE app rotating tokens. Mobius refreshes them, but the refresh token lasts 30 days, so
someone who doesn't open Mobius for a month signs in again.

## Telegram

Not built yet. It will sign in as the person's own account, with a phone number and code, through TDLib. It needs an
`api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org), under **API development tools**.

## Matrix, Discord and Signal

- **Matrix** needs no registration. People sign in to their own homeserver.
- **Discord** will be a bot the person adds to their servers. It needs an application at the Discord Developer Portal,
  and it can't read direct messages.
- **Signal** needs no registration. Mobius links as a device with a QR code, through a separate helper program, because
  Signal's library is AGPL.

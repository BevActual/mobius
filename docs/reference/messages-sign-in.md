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
     `users:read`, `chat:write`, `reactions:write`. Add no bot scopes, because a desktop sign-in can't have them.
   - Turn on **PKCE**. This can't be undone without asking Slack's support. It marks the app as a public client,
     which is what Mobius is.
3. Optional: under **Basic Information**, add the Mobius mark as the app icon.
4. Under **Basic Information**, copy the **Client ID**. It is not a secret.
5. Under **Manage Distribution**, turn on public distribution, so people outside your workspace can sign in. This needs
   no Slack review unless you list the app in the Slack Marketplace.

**Done** (18 November 2026): the app is registered in Andrew's BevingtonSystems workspace with PKCE on, and its
Client ID is built into Mobius (`CLIENT_ID` in `crates/mobius-host/src/slack.rs`). Public distribution (step 5) is not
turned on yet, so for now only people in that workspace can sign in.

**Still to do:** add the `reactions:write` user scope to the registered app (step 2), so the Messages hover tools can
react. Mobius doesn't ask for it until the app lists it, because asking for a scope the app doesn't have breaks sign-in.
Once it's added, the Builder adds it to `USER_SCOPES` in `crates/mobius-host/src/slack.rs`, and anyone already signed in
signs in to Slack once more.

What it unlocks: Settings › Messages › **Sign in to Slack**, then that workspace's channels, direct messages, groups and
threads in Messages.

What to expect: Slack hands a PKCE app rotating tokens. Mobius refreshes them, but the refresh token lasts 30 days, so
someone who doesn't open Mobius for a month signs in again.

## Microsoft Teams

Teams chats (one-to-one, group and meeting chats) come through Microsoft Graph with the same Microsoft sign-in as
OneDrive and Outlook calendars: one app registration, built in as `MOBIUS_MICROSOFT_CLIENT_ID`. Its delegated permissions
must include `Chat.ReadWrite` (see [Drives sign-in](drive-sign-in.md), step 4).

- Settings › Messages › **Sign in to Microsoft Teams…** opens Microsoft's page. The tokens are kept in the system secret
  store and refreshed there.
- Graph reads Teams chats for **work and school accounts only**. A personal Microsoft account is told so at sign-in and
  isn't added.
- Some organisations make an administrator approve apps before their people can consent. Until then, Microsoft's page
  says so.
- Teams **channels** aren't read: reading them needs an administrator's consent (`ChannelMessage.Read.All`), so only
  chats are here.
- A chat is unread when someone else wrote last after the person last read it. Opening a chat marks it read in Teams too.
  Chats hidden in Teams stay hidden. Teams chats have no threads; replies in Mobius go to the chat.

## Telegram

Telegram signs in as the person's own account and speaks Telegram's protocol (MTProto) through
[grammers](https://codeberg.org/Lonami/grammers), a pure-Rust client (MIT or Apache-2.0), so no native library ships
with Mobius.

- Settings › Messages › **Telegram phone number**, then the code Telegram sends to the person's other Telegram apps (or
  by SMS), then their two-step verification password if they set one. The password goes only to Telegram and is not
  kept. Telegram doesn't let other apps make new accounts.
- What the sign-in leaves (the account's home data centre and its authorisation key) is kept in the system secret
  store. Removing the account signs this device out of Telegram.
- Chats, groups and channels list with Telegram's own unread and mention counts. Opening one marks it read everywhere.
  Messages with only a photo, file or sticker show a line saying so.

**Registration (once, by the maintainer):** sign in at [my.telegram.org](https://my.telegram.org) with a phone number,
open **API development tools**, and create an application (any title and short name; platform Desktop). It shows an
**api_id** (a number) and an **api_hash**. They are built into release builds as `MOBIUS_TELEGRAM_API_ID` and
`MOBIUS_TELEGRAM_API_HASH`: the id as an Actions variable and the hash as an Actions secret, read by the release workflow. Until they
are, Telegram shows as not set up in this build. Forks and other builds of Mobius should register and use their own.

## Matrix, Discord and Signal

- **Matrix** needs no registration. People sign in to their own homeserver.
- **Discord** will be a bot the person adds to their servers. It needs an application at the Discord Developer Portal,
  and it can't read direct messages.
- **Signal** needs no registration. Mobius links as a device with a QR code, through a separate helper program, because
  Signal's library is AGPL.

## Matrix

Nothing to register. Matrix is open: any homeserver lets a client sign in to it, so Andrew has no step here.

- The person types their Matrix ID (`@you:matrix.org`) or their server in Settings › Messages. Mobius finds the server
  through its `/.well-known/matrix/client`, then asks it how it signs in.
- A server with the Matrix Authentication Service (matrix.org, and most new servers) signs in on its own page. Mobius
  registers itself with that server as it starts (OAuth dynamic client registration, as "Mobius" with
  `https://mobiusworkspace.com/`), then uses PKCE with a one-time page on `127.0.0.1`. There is no client secret.
- An older server signs in on its single sign-on page, or with a username and password typed into Mobius. The password
  goes only to that server and is not kept.
- Each sign-in is its own device on the account, named "Mobius". Removing the account signs that device out.
- Encrypted rooms read once this device is verified. In Settings › Messages, the person types the recovery key (or
  passphrase) they saved when they set up recovery in another Matrix app, such as Element. Mobius opens their secret
  storage with it, takes in their cross-signing keys, signs this device, and restores every message key from their
  key backup. Keys that arrive later come to this device directly. Until then an encrypted room shows one line:
  "Encrypted: verify this device in Settings > Messages to read".
- The encryption (`matrix-sdk-crypto`) keeps its state in a SQLite file per account, encrypted with a random key kept
  in the system secret store. The recovery key itself is never kept.
- A verified device writes in encrypted rooms too. Each message is encrypted for every device of everyone in the room;
  devices that don't have this device's room key yet get it first, over a one-to-one encrypted channel. New room keys
  go to the key backup, so the person's other apps can read what Mobius wrote.
- Or verify with another device: **Verify with another device** sends a request to the person's other Matrix apps.
  They accept it on one, both show the same seven emoji, and the person says whether they match. If they do, the
  devices trust each other, the other app sends Mobius the person's cross-signing keys and key backup key, and the
  backup's message keys are restored as with the recovery key. If they don't, the verification is cancelled.
- Bridged rooms (WhatsApp, Telegram, Signal and others carried into Matrix by a bridge, as Beeper does) show their
  network under the room's name, read from the bridge's own `m.bridge` room state. A bridge's management room, where
  only its bot is, is left out of the list.

What it unlocks: Settings › Messages › **Matrix ID or server**, then that account's rooms, direct messages and threads
in Messages, read markers shared with the person's other devices, and Matrix bridges they already run, each
room labelled with its network.

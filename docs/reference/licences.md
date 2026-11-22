# Licences: what Mobius may ship

Mobius is MIT. Everything it bundles has to stay shippable under that, so:

- **Embed only permissive code.** That means MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0, Unicode, OFL for fonts and the like. An expression with a permissive choice counts (`MIT OR LGPL-2.1` is fine). Keep each embedded project's licence file in the installer.
- **Never bundle copyleft code** (GPL, LGPL, AGPL, SSPL). In particular, never bundle the AGPL Matrix products: Synapse, Element's apps and Element Call. Talking to them over the network is fine. Mobius's Messages app is a Matrix client and works with any server.
- **Check each licence in the project's own repository before embedding it**, and note it in the pull request. This applies to a homeserver from the Conduit family, LiveKit, and anything else new. Tuwunel is Apache-2.0 (its `LICENSE`, and `license` in its `Cargo.toml`, checked 2026-11-22).

CI enforces this. `node scripts/check-licences.mjs` reads every crate `cargo metadata` resolves and every npm package the lockfile installs outside dev dependencies. It fails on a copyleft licence, a package with no licence, or one of the products above.

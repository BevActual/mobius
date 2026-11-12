# Security policy

Mobius is an agent that can read and change your files, mail and other apps, so we take security reports seriously.

## Reporting a problem

Please **don't open a public issue** for a security problem. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/BevActual/mobius/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with it. We'll acknowledge the report within
a few days, keep you updated while we fix it, and credit you in the release notes if you'd like.

## Scope

Especially welcome:

- Ways to make Mobius send, pay, delete or run a command without asking first.
- Instructions hidden in a web page, email or file that take control of the agent (prompt injection).
- Ways to read keys or sign-in tokens from the secret store, or to reach them from the interface.
- Ways for a web page in the Browser app to reach Mobius's own interface or core.

## Supported versions

Mobius is an early preview. Fixes go into the latest release only.

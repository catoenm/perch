# Perch Privacy Policy

_Last updated: August 25, 2026_

Perch is a local dashboard for your own Claude Code agent sessions. It is
designed so that your data never leaves your machine.

## What the extension does

The Perch browser extension replaces your new tab page with a dashboard. It
communicates exclusively with a companion server that you install and run on
your own computer (`perch-dashboard` on npm, source at
https://github.com/catoenm/perch), reachable only at the loopback address
`127.0.0.1:4242`.

## Data collection

- The extension collects **no** personal data, browsing history, or usage data.
- It makes **no** requests to any remote host. All traffic is confined to your
  own machine's loopback interface.
- It contains **no** analytics, telemetry, tracking, or remote code.

## What the companion server reads

The local server reads Claude Code's session files from your home directory
(`~/.claude`) to display your agents' status. Optionally, it summarizes session
titles using the Claude CLI already installed on your machine — those requests
are made by your own `claude` installation under your own account, exactly as
if you had typed a prompt yourself, and can be disabled with `PERCH_NO_LLM=1`.
The server binds to `127.0.0.1` only and is never reachable from the network.

## Data sharing

Nothing is collected, so nothing is shared, sold, or transferred.

## Changes

Changes to this policy will appear in this file's history in the public
repository.

## Contact

Open an issue at https://github.com/catoenm/perch/issues.

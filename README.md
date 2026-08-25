# Perch 🐦

**A calm view over every Claude Code agent you have running.**

If you run several Claude Code sessions across terminals, you know the feeling:
something is working somewhere, something else is waiting on you, and you can't
remember which tab is which. Perch is a local dashboard — made to live in your
browser's new-tab page — that shows every live agent at a glance:

- **Status** — working, running a shell command, or waiting on you (with a pulse when busy)
- **What it's doing** — your last prompt ("task") and the agent's latest reply ("now")
- **Context meter** — tokens used vs. the context window, amber past 80%, red past 92%
- **Vitals** — model, tty, uptime, time in current status, project path, git branch
- **A face** — every agent gets a unique little bird, generated from its session id,
  so you can recognize "the orange one in backend" without reading anything
- **Click to jump** — clicking a card raises that agent's Ghostty window (best effort)

Zero dependencies. One Node process. Nothing leaves your machine.

## How it works

Claude Code already writes everything Perch needs under `~/.claude`:

- `~/.claude/sessions/<pid>.json` — one file per live session: pid, session id,
  cwd, name, live status (`busy` / `shell` / `idle` / …), timestamps. Perch
  cross-checks the pid against `ps` so dead sessions never show up.
- `~/.claude/projects/<project-slug>/<session-id>.jsonl` — the transcript. Perch
  tails the last ~512 KB to pull the model, the latest token usage
  (`input + cache_read + cache_creation` = current context), the git branch,
  your last prompt, and the agent's last reply.

Perch only ever **reads** these files. The context window is inferred: usage
above 195k tokens means a 1M-context session, otherwise 200k.

## Run it

```sh
node server.mjs          # http://localhost:4242
```

Or keep it running permanently (starts on login, restarts if it dies):

```sh
node server.mjs install    # writes + loads a LaunchAgent (macOS)
node server.mjs uninstall  # removes it
```

Logs go to `~/Library/Logs/perch.log`. Set `PERCH_PORT` to change the port.

## Put it in your new tab

Browsers don't let a plain URL be the new-tab page, so use a tiny extension:

- **Chrome / Arc / Edge**: [New Tab Redirect](https://chrome.google.com/webstore/detail/new-tab-redirect/icpgjfneehieebagbmdbhnlpiopdcmna) → set `http://localhost:4242`
- **Firefox**: New Tab Override → set `http://localhost:4242`
- **Safari**: Settings → General → New tabs open with → Homepage → `http://localhost:4242`

## Jumping to Ghostty

Ghostty has no URL scheme, so clicking a card is best-effort: Perch activates
Ghostty, then uses macOS Accessibility to find a window whose title matches the
agent's session name or project folder and raises it.

- First click may prompt for **Automation** permission (controlling Ghostty /
  System Events). Grant it to the process that runs Perch (`node`, or your
  terminal if you ran it manually).
- If no title matches, Perch just brings Ghostty to the front — you're one
  Cmd-\` away instead of fully lost.
- Title matching works best if your shell/Claude sets terminal titles (the
  default Claude Code behavior).

## Status legend

| Pill | Meaning |
|---|---|
| 🟢 working (pulsing) | The agent is actively doing things (`busy`, `shell`, `compacting`) |
| 🟡 your turn | The agent finished and is waiting for input |
| 🟠 needs approval / pinged you | Blocked on a permission or notification |
| ⚪ anything else | Shown verbatim so new Claude Code statuses still surface |

## Notes

- macOS only (uses `ps`, `lsof`-free, `osascript`, launchd). The dashboard and
  data layer would port to Linux easily; window-jumping would not.
- Perch binds to `127.0.0.1` only.
- Tested with Claude Code 2.1.x session formats.

## License

MIT

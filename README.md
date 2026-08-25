# Perch 🐦

**A calm view over every Claude Code agent you have running.**

If you run several Claude Code sessions across terminals, you know the feeling:
something is working somewhere, something else is waiting on you, and you can't
remember which tab is which. Perch is a local dashboard — made to live in your
browser's new-tab page — that shows every live agent, **ranked by what needs
your attention first**:

- **Real titles** — a small local model (via your own `claude` CLI) summarizes
  each session into a headline like *"Fixing PR #32789 review comments"*
- **Attention ranking** — agents are scored 0–100 and grouped into **Needs you /
  Working / Parked**, with a one-line reason ("needs YubiKey touch", "context
  almost full"). The header always shows what's next up.
- **Status** — working, running a shell command, or waiting on you (pulse when busy)
- **Context meter** — tokens used vs. the window, amber past 80%, red past 92%
- **Vitals** — model, tty, uptime, time in current status, project path, git branch
- **A face** — every agent gets a unique little bird, generated from its session
  id, so you can recognize "the orange one in backend" without reading anything
- **Click to jump** — clicking a card focuses that agent's exact Ghostty
  terminal: window, tab, even the right split

One Node process, zero npm dependencies. Nothing leaves your machine except the
title summaries, which go through your own `claude` CLI like any other prompt.

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

### Titles & attention scores

When an agent gets a new prompt or changes state, Perch pipes the last exchange
through `claude -p` with a small model (default `claude-haiku-4-5-20251001`) and
asks for strict JSON: a 3–7 word title, an urgency score 0–10, and a short
reason. That LLM urgency is blended with hard signals — status bucket, how long
the agent has been waiting, context pressure — into the 0–100 attention score
that orders the page. Results are cached in `~/Library/Caches/perch-titles.json`
and refreshed at most once a minute per session (every 10 minutes for
long-running autonomous work), so the cost is a handful of Haiku calls per hour.

- `PERCH_NO_LLM=1` disables all of this (deterministic titles and scores remain)
- `PERCH_TITLE_MODEL=...` picks a different model

### Jumping to the exact terminal

Ghostty ≥ 1.3 ships a native AppleScript dictionary (terminal surfaces with
titles, working directories, and a `focus` command). Perch combines that with a
trick: it knows each agent's tty, so on click it writes a unique title marker
straight to `/dev/ttysNNN` (an escape sequence the terminal renders), asks
Ghostty to focus the surface carrying the marker, then rewrites the title to the
agent's real headline. That's an exact match — right window, right tab, right
split — with no Accessibility APIs involved.

The first click will prompt once for **Automation** permission (the process
running Perch wants to control Ghostty). If the marker can't be found (agent
inside tmux/ssh, or a non-Ghostty terminal), Perch falls back to matching the
surface's working directory, then to just bringing Ghostty forward.

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

**Option A — the bundled Chrome extension** (`extension/`): open
`chrome://extensions`, enable Developer mode, **Load unpacked**, pick the
`extension/` folder. Every new tab is now Perch (it talks to the local server,
which must be running). After editing `public/`, run `npm run build-ext` to sync
the extension copy.

**Option B — point your browser at the server**:

- **Firefox**: New Tab Override extension → `http://localhost:4242`
- **Safari**: Settings → General → New tabs open with → Homepage → `http://localhost:4242`
- **Chrome/Arc/Edge without the bundled extension**: New Tab Redirect → `http://localhost:4242`

## Status legend

| Pill | Meaning |
|---|---|
| 🟢 working (pulsing) | The agent is actively doing things (`busy`, `shell`, `compacting`) |
| 🟡 your turn | The agent finished and is waiting for input |
| 🟠 needs approval / pinged you | Blocked on a permission or notification |
| ⚪ anything else | Shown verbatim so new Claude Code statuses still surface |

## Notes

- macOS only (uses `ps`, `osascript`, launchd, Ghostty AppleScript). The
  dashboard and data layer would port to Linux easily; terminal-jumping would
  need a different mechanism.
- Perch binds to `127.0.0.1` only. The API allows CORS solely for
  browser-extension origins.
- Tested with Claude Code 2.1.x session formats and Ghostty 1.3.1.

## License

MIT

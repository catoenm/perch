# Chrome Web Store submission kit

Everything needed to publish Perch. Total human time: ~10 minutes + review wait.

## Steps

1. Register (one-time, $5): https://chrome.google.com/webstore/devconsole
2. **New item** → upload `dist/perch-extension.zip` (rebuild anytime with `npm run pack-ext`)
3. **Store listing tab** — paste from the sections below; upload the three
   screenshots and the promo tile from this folder
4. **Privacy tab** — paste the privacy answers below
5. **Distribution** — visibility: start **Unlisted** (shareable by link), flip to
   Public whenever
6. Submit for review (typically 1–3 days; new-tab overrides get a closer look,
   but this one is clean: no remote code, no analytics, localhost-only traffic)

After it's published: grab the extension ID from the store URL and pin the
server's CORS to it (ask Claude, or edit `corsHeaders` in `server.mjs`).

## Listing copy

**Name:** Perch

**Summary (132 chars max):**
Your Claude Code agents on every new tab — status, context, attention ranking, and one click back to the right terminal.

**Category:** Workflow & Planning (or Developer Tools)

**Language:** English

**Description:**

Running several Claude Code sessions at once means something is always working
somewhere — and something else is quietly waiting on you in a terminal you
forgot about. Perch turns every new tab into a calm dashboard of all of them.

• See every live agent: status (working / your turn / needs approval), the task
  you gave it, and what it's doing right now
• Attention ranking — agents are scored and grouped by how urgently they need
  you, with a one-line reason ("needs YubiKey touch", "context almost full")
• Bird codenames — every session gets a memorable identity like Indigo Finch or
  Copper Owl, and its avatar is drawn from the name
• Context meters — tokens used vs. the window, amber at 80%, red at 92%
• Click a card to jump to that agent's exact Ghostty terminal — right window,
  right tab, right split
• Broadcast one prompt to many agents at once
• Pin important sessions, six themes, and an analytics tab: how long agents
  wait on you, and your agent-hours per day

Perch's data comes from a tiny open-source companion server that runs on your
machine and reads Claude Code's local session files. Install it once:

    npm install -g perch-dashboard && perch install

Nothing leaves your machine — the extension talks only to 127.0.0.1. Source:
https://github.com/catoenm/perch

**Screenshots:** `screenshot-1-roost.png`, `screenshot-2-analytics.png`,
`screenshot-3-cappuccino.png` (1280×800, demo data)

**Small promo tile:** `promo-440x280.png`

## Privacy tab answers

**Single purpose:** Displays a local dashboard of the user's own Claude Code
agent sessions in the new tab page.

**Permission justification — host_permissions (http://localhost:4242, http://127.0.0.1:4242):**
The extension renders data served by a companion program the user installs and
runs on their own machine (an open-source local web server). All requests go
exclusively to the loopback interface; no remote hosts are contacted.

**chrome_url_overrides (newtab):** The product is a new-tab dashboard; replacing
the new tab page is its single purpose.

**Data usage:** No user data is collected, stored, or transmitted by the
extension. All information displayed originates on the user's machine and never
leaves it. No analytics, no remote code.

**Remote code:** None. All JavaScript is packaged in the extension.

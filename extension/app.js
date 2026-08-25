/* Perch frontend — polls /api/agents, renders the roost ranked by attention. */

// Same file serves the local page and the Chrome extension's new tab.
const API = location.protocol.startsWith("http") ? "" : "http://localhost:4242";
const POLL_MS = 3000;
const NEEDS_YOU = 45; // attention score threshold

const grid = document.getElementById("grid");
const themePick = document.getElementById("theme");

// ------------------------------------------------------------------- themes

function applyTheme(name) {
  if (name === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = name;
}
const savedTheme =
  new URLSearchParams(location.hash.slice(1)).get("theme") ||
  localStorage.getItem("perch-theme") ||
  "auto";
applyTheme(savedTheme);
themePick.value = savedTheme;
themePick.addEventListener("change", () => {
  localStorage.setItem("perch-theme", themePick.value);
  applyTheme(themePick.value);
});

const topstats = document.getElementById("topstats");
const freshness = document.getElementById("freshness");
const toast = document.getElementById("toast");

// -------------------------------------------------------------- formatting

function ago(ms) {
  if (!ms) return "–";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return Math.floor(s) + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
}

function tokens(n) {
  if (n == null) return "–";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return String(n);
}

function shortModel(model) {
  return model ? model.replace(/^claude-/, "") : "–";
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

// ------------------------------------------------------------- bird avatar

function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Keep in sync with PLUMAGE/SPECIES in server.mjs — the codename IS the bird:
// the color word picks the feathers, the species picks the silhouette.
const PLUMAGE = [
  ["#3987e5", "#1c5cab"], ["#d95926", "#9c3a12"], ["#199e70", "#0c6b4a"],
  ["#c98500", "#8f5e00"], ["#d55181", "#a02c58"], ["#008300", "#005700"],
  ["#9085e9", "#5c4fc0"], ["#e66767", "#b13030"], ["#14919b", "#0b5f66"],
  ["#e8a13c", "#a06a12"], ["#a86bc9", "#6f3f8f"], ["#7d8ca3", "#4d5a70"],
  ["#8a9a3c", "#5a6620"], ["#ef8968", "#bc5233"], ["#4a5fc1", "#2b3a85"],
  ["#6aa06a", "#3f6b3f"],
];

// Finch, Wren, Owl, Heron, Robin, Sparrow, Kingfisher, Cardinal,
// Chickadee, Swallow, Puffin, Magpie
const SPECIES_DRAW = [
  { r: 16, wing: true, beak: 6, tufts: 1 },
  { r: 13, wing: true, beak: 5, tail: "up" },
  { r: 19, ears: true, eyes: "front", beak: 0, belly: true },
  { r: 13, neck: true, beak: 11, legLong: true },
  { r: 16, wing: true, beak: 6, belly: true },
  { r: 15, wing: true, beak: 5, stripe: true },
  { r: 16, wing: true, beak: 12, crest: true },
  { r: 15, wing: true, beak: 6, crest: true, mask: true },
  { r: 14, wing: true, beak: 4, cap: true, cheek: true },
  { r: 14, wing: true, beak: 4, tail: "fork" },
  { r: 18, beak: 8, beakH: 6, belly: true },
  { r: 15, wing: true, beak: 5, tail: "long", belly: true },
];

function birdSvg(agent) {
  const avatar = agent.avatar || {
    c: hashCode(agent.sessionId) % PLUMAGE.length,
    s: (hashCode(agent.sessionId) >>> 8) % SPECIES_DRAW.length,
    seed: hashCode(agent.sessionId),
  };
  const [body, dark] = PLUMAGE[avatar.c % PLUMAGE.length];
  const spec = SPECIES_DRAW[avatar.s % SPECIES_DRAW.length];
  const r = spec.r;
  const cy = (spec.legLong ? 42 : 47) - r;
  const tilt = -14 + (avatar.seed >>> 6) % 5 * 7;
  const parts = [];

  parts.push(`<rect width="64" height="64" fill="${body}" opacity="0.13"/>`);
  parts.push(`<path d="M8 52h48" stroke="${dark}" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>`);
  parts.push(`<line x1="27" y1="${cy + r - 3}" x2="27" y2="52" stroke="${dark}" stroke-width="${spec.legLong ? 1.6 : 2}"/>`);
  parts.push(`<line x1="35" y1="${cy + r - 3}" x2="35" y2="52" stroke="${dark}" stroke-width="${spec.legLong ? 1.6 : 2}"/>`);

  // behind-the-body features
  if (spec.tail === "up") parts.push(`<path d="M${31 - r + 2} ${cy + 2} l-9 -8 l4 10 z" fill="${dark}"/>`);
  if (spec.tail === "fork") parts.push(
    `<path d="M${31 - r + 2} ${cy + 1} l-12 -4 l5 6 z" fill="${dark}"/>`,
    `<path d="M${31 - r + 2} ${cy + 5} l-11 5 l5 2 z" fill="${dark}"/>`);
  if (spec.tail === "long") parts.push(`<path d="M${31 - r + 3} ${cy + 4} l-15 7 l3 4 l13 -6 z" fill="${dark}"/>`);
  if (spec.ears) parts.push(
    `<path d="M${31 - r * 0.55} ${cy - r * 0.6} l-3 -8 l8 3 z" fill="${dark}"/>`,
    `<path d="M${31 + r * 0.55} ${cy - r * 0.6} l3 -8 l-8 3 z" fill="${dark}"/>`);
  if (spec.crest) parts.push(`<path d="M31 ${cy - r - 7} l6 9 l-11 1 z" fill="${dark}"/>`);
  if (spec.tufts) parts.push(`<path d="M29 ${cy - r + 2} q0 -7 -3 -9" stroke="${dark}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
  if (spec.neck) {
    const hx = 38, hy = cy - r - 7;
    parts.push(
      `<path d="M33 ${cy - 5} Q${hx - 1} ${hy + 10} ${hx - 1} ${hy + 2}" stroke="${body}" stroke-width="4.5" fill="none" stroke-linecap="round"/>`,
      `<circle cx="${hx}" cy="${hy}" r="5.5" fill="${body}"/>`,
      `<path d="M${hx + 4} ${hy - 2} l11 2 l-11 2 z" fill="${dark}"/>`,
      `<circle cx="${hx + 1.5}" cy="${hy - 1.5}" r="1.5" fill="#0b0b0b"/>`);
  }

  parts.push(`<circle cx="31" cy="${cy}" r="${r}" fill="${body}"/>`);
  if (spec.cap) parts.push(`<path d="M${31 - r} ${cy} a${r} ${r} 0 0 1 ${2 * r} 0 z" fill="${dark}" opacity="0.85"/>`);
  if (spec.belly) parts.push(`<ellipse cx="29" cy="${cy + r * 0.45}" rx="${r * 0.62}" ry="${r * 0.5}" fill="#ffffff" opacity="0.3"/>`);
  if (spec.wing) parts.push(`<ellipse cx="${28 - r / 4}" cy="${cy + 3}" rx="${r * 0.55}" ry="${r * 0.4}" fill="${dark}" transform="rotate(${tilt} ${28 - r / 4} ${cy + 3})"/>`);
  if (spec.stripe) parts.push(`<line x1="${24 - r / 4}" y1="${cy + 3}" x2="${31 - r / 4}" y2="${cy + 1}" stroke="#ffffff" opacity="0.4" stroke-width="1.5"/>`);
  if (spec.cheek) parts.push(`<circle cx="${31 + r * 0.35}" cy="${cy - r * 0.1}" r="${r * 0.32}" fill="#ffffff" opacity="0.5"/>`);

  if (spec.eyes === "front") {
    for (const dx of [-5, 5]) parts.push(
      `<circle cx="${31 + dx}" cy="${cy - r * 0.28}" r="3.4" fill="#ffffff" opacity="0.9"/>`,
      `<circle cx="${31 + dx}" cy="${cy - r * 0.28}" r="1.7" fill="#0b0b0b"/>`);
    parts.push(`<path d="M31 ${cy - r * 0.05} l3.5 0 l-1.75 5 z" fill="${dark}"/>`);
  } else if (!spec.neck) {
    if (spec.mask) parts.push(`<circle cx="${31 + r * 0.45}" cy="${cy - r * 0.3}" r="4.5" fill="${dark}"/>`);
    parts.push(
      `<circle cx="${31 + r * 0.45}" cy="${cy - r * 0.35}" r="2.2" fill="#0b0b0b"/>`,
      `<circle cx="${31 + r * 0.45 + 0.7}" cy="${cy - r * 0.35 - 0.7}" r="0.7" fill="#ffffff"/>`);
    if (spec.beak) {
      const bh = spec.beakH || (spec.beak >= 10 ? 4 : 2.6);
      parts.push(`<path d="M${31 + r - 1} ${cy - r * 0.18 - bh} l${spec.beak} ${bh} l-${spec.beak} ${bh} z" fill="${dark}"/>`);
    }
  }

  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

// ---------------------------------------------------------------- rendering

let lastPayload = "";

function card(agent) {
  const pct = agent.contextPct;
  const fillClass = pct >= 92 ? "crit" : pct >= 80 ? "warn" : "";
  const needsYou = agent.attention >= NEEDS_YOU;
  const whyClass = agent.attention >= 70 ? "crit" : needsYou ? "warn" : "";
  return `
  <article class="card ${agent.bucket === "working" || needsYou ? "" : "dim"}${selectMode ? (selected.has(agent.pid) ? " selected" : " selectable") : ""}" data-pid="${agent.pid}" title="${selectMode ? "Click to select" : "Click to jump to this Ghostty terminal"}">
    <div class="card-top">
      <div class="avatar">${birdSvg(agent)}</div>
      <div class="idcol">
        <h2><span class="h2text">${esc(agent.title || agent.lastPrompt || agent.codename || agent.name)}</span><button class="edit" data-session="${agent.sessionId}" title="Rename">✎</button></h2>
        <div class="path"><b>${esc(agent.codename || agent.name)}</b> · ${esc(agent.project)}${agent.gitBranch && agent.gitBranch !== "HEAD" ? " · " + esc(agent.gitBranch) : ""}</div>
      </div>
      <div class="pill s-${agent.bucket}"><span class="dot"></span>${esc(agent.statusLabel)}</div>
      <span class="actions">
        <button class="peekbtn" data-pid="${agent.pid}" title="Show conversation" aria-label="Show conversation">⤢</button>
        <button class="msg" data-pid="${agent.pid}" data-codename="${esc(agent.codename || agent.name)}"
          title="Send a prompt to this agent" aria-label="Send a prompt to this agent">➤</button>
        <button class="star ${agent.starred ? "on" : ""}" data-session="${agent.sessionId}"
          title="${agent.starred ? "Unpin" : "Pin to top"}" aria-label="${agent.starred ? "Unpin" : "Pin to top"}">★</button>
      </span>
    </div>
    <p class="line why ${whyClass}"><span class="k">why</span><span class="v">${esc(agent.attentionReason)} · attention ${agent.attention}</span></p>
    ${agent.lastPrompt ? `<p class="line task"><span class="k">task</span><span class="v">${esc(agent.lastPrompt)}</span></p>` : ""}
    ${agent.lastAssistant ? `<p class="line now"><span class="k">now</span><span class="v">${esc(agent.lastAssistant)}</span></p>` : ""}
    <div class="meter">
      <div class="track"><div class="fill ${fillClass}" style="width:${pct ?? 0}%"></div></div>
      <span class="label">${tokens(agent.contextTokens)} / ${tokens(agent.contextWindow)}${pct != null ? " · " + pct + "%" : ""}</span>
    </div>
    <div class="meta">
      <span class="chip model">${esc(shortModel(agent.model))}</span>
      <span class="chip">${esc(agent.name)}</span>
      <span class="chip">${esc(agent.tty || "?")}</span>
      <span class="chip">up ${ago(agent.startedAt)}</span>
      <span class="chip">${esc(agent.statusLabel)} for ${ago(agent.statusUpdatedAt)}</span>
      ${agent.queued ? `<span class="chip qd" data-pid="${agent.pid}" title="Click to cancel queued messages">✉ ${agent.queued} queued</span>` : ""}
    </div>
  </article>`;
}

function section(label, agents) {
  if (!agents.length) return "";
  return `<h3 class="section">${label} <span>${agents.length}</span></h3>` + agents.map(card).join("");
}

function render(agents) {
  const byScore = (a, b) => b.attention - a.attention;
  const pinned = agents.filter((a) => a.starred).sort(byScore);
  const rest0 = agents.filter((a) => !a.starred);
  const needsYou = rest0.filter((a) => a.attention >= NEEDS_YOU).sort(byScore);
  const working = rest0
    .filter((a) => a.attention < NEEDS_YOU && a.bucket === "working")
    .sort(byScore);
  const rest = rest0
    .filter((a) => a.attention < NEEDS_YOU && a.bucket !== "working")
    .sort(byScore);

  const next = needsYou[0];
  topstats.innerHTML = agents.length
    ? next
      ? `next up: <b>${esc(next.codename || next.name)}</b> — ${esc(next.attentionReason)}`
      : `<b>${agents.length}</b> on the perch · all working, nothing needs you 🎉`
    : "";

  grid.innerHTML = agents.length
    ? section("Pinned", pinned) + section("Needs you", needsYou) + section("Working", working) + section("Parked", rest)
    : `<div class="empty"><span class="glyph">🪹</span>No agents on the perch.<br>Start one with <code>claude</code> and it will appear here.</div>`;
}

// ------------------------------------------------------------------ events

// ---------------------------------------------------------------- broadcast

const bcastBtn = document.getElementById("bcastbtn");
const bcastBar = document.getElementById("bcastbar");
const bcastText = document.getElementById("bcasttext");
const bcastSend = document.getElementById("bcastsend");
let selectMode = false;
const selected = new Set();

function setSelectMode(on) {
  selectMode = on;
  if (!on) selected.clear();
  if (on && !document.getElementById("spawnbar").hidden) {
    document.getElementById("spawnbar").hidden = true;
    document.getElementById("spawnbtn").classList.remove("on");
  }
  bcastBar.hidden = !on;
  bcastBtn.classList.toggle("on", on);
  updateSendButton();
  lastPayload = "";
  render(lastAgents);
  if (on) {
    setView("roost");
    bcastText.focus();
  }
}

function updateSendButton() {
  bcastSend.textContent = selected.size ? `Send to ${selected.size}` : "Send";
  bcastSend.disabled = !selected.size || !bcastText.value.trim();
}

bcastBtn.addEventListener("click", () => setSelectMode(!selectMode));

// ------------------------------------------------------------------- spawn

const spawnBar = document.getElementById("spawnbar");
const spawnDir = document.getElementById("spawndir");
const spawnBtn = document.getElementById("spawnbtn");

function setSpawnMode(on) {
  spawnBar.hidden = !on;
  spawnBtn.classList.toggle("on", on);
  if (on) {
    if (selectMode) setSelectMode(false);
    const dirs = [...new Set(lastAgents.map((a) => a.project))];
    document.getElementById("spawndirs").innerHTML = dirs
      .map((d) => `<option value="${esc(d)}">`)
      .join("");
    spawnDir.focus();
  }
}

async function doSpawn(mode) {
  const cwd = spawnDir.value.trim();
  if (!cwd) return;
  showToast("Hatching a new agent…");
  try {
    const res = await fetch(API + "/api/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, mode }),
    });
    const out = await res.json();
    if (out.ok) {
      showToast("Ghostty opened — the bird lands here in a few seconds");
      spawnDir.value = "";
      setSpawnMode(false);
    } else {
      showToast(out.reason === "directory not found" ? "That directory doesn't exist" : "Couldn't open Ghostty");
    }
  } catch {
    showToast("Spawn failed");
  }
}

spawnBtn.addEventListener("click", () => setSpawnMode(spawnBar.hidden));
document.getElementById("spawncancel").addEventListener("click", () => setSpawnMode(false));
document.getElementById("spawngo").addEventListener("click", () => doSpawn("window"));
document.getElementById("spawntab").addEventListener("click", () => doSpawn("tab"));
spawnDir.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") doSpawn(e.metaKey || e.ctrlKey ? "tab" : "window");
  if (e.key === "Escape") setSpawnMode(false);
});

// ----------------------------------------------------------------- hotkeys
// ⌘B on macOS, Ctrl+B elsewhere. Esc closes (handled by the bar/composers).

const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);
document.getElementById("bcastkbd").textContent = IS_MAC ? "⌘B" : "Ctrl+B";
document.addEventListener("keydown", (e) => {
  const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
    e.preventDefault();
    setSelectMode(!selectMode);
  }
});
document.getElementById("bcastcancel").addEventListener("click", () => setSelectMode(false));
bcastText.addEventListener("input", updateSendButton);
bcastText.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !bcastSend.disabled) bcastSend.click();
  if (e.key === "Escape") setSelectMode(false);
});
document.getElementById("bcastall").addEventListener("click", () => {
  for (const a of lastAgents) selected.add(a.pid);
  updateSendButton();
  lastPayload = "";
  render(lastAgents);
});
document.getElementById("bcastwaiting").addEventListener("click", () => {
  selected.clear();
  for (const a of lastAgents) {
    if (a.bucket === "yourturn" || a.bucket === "blocked") selected.add(a.pid);
  }
  updateSendButton();
  lastPayload = "";
  render(lastAgents);
});
bcastSend.addEventListener("click", async () => {
  const text = bcastText.value.trim();
  const pids = [...selected];
  if (!text || !pids.length) return;
  bcastSend.disabled = true;
  showToast(`Sending to ${pids.length} agent${pids.length > 1 ? "s" : ""}…`);
  try {
    const res = await fetch(API + "/api/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pids, text }),
    });
    const { results } = await res.json();
    const ok = results.filter((r) => r.sent).length;
    const queued = results.filter((r) => r.queued).length;
    const failed = results.filter((r) => !r.sent && !r.queued);
    const parts = [];
    if (ok) parts.push(`sent to ${ok}`);
    if (queued) parts.push(`queued for ${queued} (delivers when they're done)`);
    if (failed.length) parts.push(`failed: ${failed.map((f) => f.name || f.pid).join(", ")}`);
    showToast(parts.join(" · ") || "Nothing sent");
    bcastText.value = "";
    setSelectMode(false);
  } catch {
    showToast("Broadcast failed");
    bcastSend.disabled = false;
  }
});

let editing = false;

function startRename(editBtn) {
  const h2 = editBtn.closest("h2");
  const textEl = h2.querySelector(".h2text");
  const sessionId = editBtn.dataset.session;
  const input = document.createElement("input");
  input.className = "renameinput";
  input.value = textEl.textContent;
  input.maxLength = 48;
  editing = true;
  h2.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    editing = false;
    if (save) {
      try {
        await fetch(API + "/api/rename", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, title: input.value }),
        });
        showToast(input.value.trim() ? "Renamed" : "Reverted to auto label");
      } catch {
        showToast("Rename failed");
      }
    }
    lastPayload = "";
    tick();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
}

function openComposer(msgBtn) {
  const cardEl = msgBtn.closest(".card");
  const existing = cardEl.querySelector(".composer");
  if (existing) return existing.querySelector("input").focus();
  const pid = Number(msgBtn.dataset.pid);
  const codename = msgBtn.dataset.codename;
  const composer = document.createElement("div");
  composer.className = "composer";
  composer.innerHTML = `<input type="text" maxlength="4000" placeholder="Send a prompt to ${codename} — Enter submits it" /><button>Send</button>`;
  cardEl.appendChild(composer);
  editing = true;
  const input = composer.querySelector("input");
  const close = () => {
    editing = false;
    composer.remove();
  };
  const send = async () => {
    const text = input.value.trim();
    if (!text) return close();
    close();
    showToast(`Sending to ${codename}…`);
    try {
      const res = await fetch(API + "/api/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pids: [pid], text }),
      });
      const { results } = await res.json();
      const r = results[0] || {};
      showToast(r.sent ? `Sent to ${codename} ➤` : r.queued ? `Queued — ${codename} gets it when it's done` : `Couldn't reach ${codename}'s terminal`);
    } catch {
      showToast("Send failed");
    }
  };
  composer.addEventListener("click", (e) => e.stopPropagation());
  composer.querySelector("button").addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") send();
    if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input && composer.isConnected && !composer.contains(document.activeElement)) close(); }, 150));
  input.focus();
}

// -------------------------------------------------------- markdown (light)
// Escape first, then decorate. Links only for http(s), quotes neutralized.

function md(text) {
  let s = esc(text);
  s = s.replace(/```\w*\n?([\s\S]*?)```/g, (m, code) => `<pre class="mdcode">${code.trimEnd()}</pre>`);
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/gm, "$1<i>$2</i>");
  s = s.replace(/^#{1,4}\s+(.+)$/gm, '<span class="mdh">$1</span>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) =>
    `<a href="${url.replace(/"/g, "%22")}" target="_blank" rel="noopener">${label}</a>`);
  return s;
}

// -------------------------------------------------------------- image paste
// Pasted images upload to the local server, which saves them to disk; the
// file path is inserted into the prompt for the agent to Read.

function attachPasteHandler(input) {
  input.addEventListener("paste", async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    showToast("Uploading image…");
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    try {
      const res = await fetch(API + "/api/attachment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: dataUrl }),
      });
      const out = await res.json();
      if (!out.path) throw new Error();
      const sep = input.value && !input.value.endsWith(" ") ? " " : "";
      input.value += `${sep}Look at the image at ${out.path} `;
      input.dispatchEvent(new Event("input"));
      showToast("Image attached — path added to the prompt");
    } catch {
      showToast("Image upload failed");
    }
  });
}
attachPasteHandler(bcastText);
attachPasteHandler(document.getElementById("peekinput"));

// ---------------------------------------------------------- transcript peek

const peekEl = document.getElementById("peek");
const peekBody = document.getElementById("peekbody");
let peekPid = null;
let peekTimer = null;
let peekPayload = "";
let lastPeekData = null;
let pendingMsgs = []; // optimistic sends: { text, state: sending|sent|failed }

const normText = (s) => (s || "").replace(/\s+/g, " ").trim();

function renderPeek(data) {
  if (data) lastPeekData = data;
  else data = lastPeekData;
  if (!data) return;
  // drop optimistic bubbles once the real transcript shows them
  const userNorms = data.messages
    .filter((m) => m.role === "user")
    .slice(-10)
    .map((m) => normText(m.text));
  pendingMsgs = pendingMsgs.filter(
    (p) => p.state !== "sent" || !userNorms.some((u) => u.startsWith(normText(p.text).slice(0, 200)))
  );
  const payload = JSON.stringify([data.messages, pendingMsgs]);
  if (payload === peekPayload) return;
  peekPayload = payload;
  const atBottom = peekBody.scrollHeight - peekBody.scrollTop - peekBody.clientHeight < 60;
  const STATE_TAG = { sending: " · sending…", sent: " · sent", failed: " · failed" };
  peekBody.innerHTML =
    (data.messages.map((m) => {
      if (m.role === "tools") return `<div class="m-tools">⋯ ${m.count} tool call${m.count > 1 ? "s" : ""} ⋯</div>`;
      const tag = m.queued ? " · queued — delivers when it's done" : "";
      return `<div class="m ${m.role}${m.queued ? " pending" : ""}"><span class="who">${m.role === "user" ? "you" : "agent"}${tag}</span><div class="bubble">${md(m.text)}</div></div>`;
    }).join("") +
    pendingMsgs.map((p) =>
      `<div class="m user pending ${p.state}"><span class="who">you${STATE_TAG[p.state] || ""}</span><div class="bubble">${md(p.text)}</div></div>`
    ).join("")) || `<div class="m-tools">no conversation yet</div>`;
  if (atBottom || !peekBody.dataset.scrolled) peekBody.scrollTop = peekBody.scrollHeight;
}

async function refreshPeek() {
  if (peekPid == null) return;
  try {
    const res = await fetch(`${API}/api/transcript?pid=${peekPid}`);
    if (!res.ok) throw new Error();
    renderPeek(await res.json());
  } catch {
    peekBody.innerHTML = `<div class="m-tools">couldn't load transcript</div>`;
  }
}

function openPeek(pid) {
  const agent = lastAgents.find((a) => a.pid === pid);
  if (!agent) return;
  peekPid = pid;
  peekPayload = "";
  lastPeekData = null;
  pendingMsgs = [];
  document.getElementById("peekavatar").innerHTML = birdSvg(agent);
  document.getElementById("peektitle").textContent = agent.title || agent.codename;
  document.getElementById("peeksub").textContent = `${agent.codename} · ${agent.project}`;
  document.getElementById("peekinput").placeholder = `Send a prompt to ${agent.codename} — Enter submits it`;
  peekBody.innerHTML = `<div class="m-tools">loading…</div>`;
  peekEl.hidden = false;
  refreshPeek();
  clearInterval(peekTimer);
  peekTimer = setInterval(refreshPeek, 3000);
}

function closePeek() {
  peekEl.hidden = true;
  peekPid = null;
  clearInterval(peekTimer);
}

peekEl.addEventListener("click", (e) => {
  if (e.target === peekEl) closePeek();
});
document.getElementById("peekclose").addEventListener("click", closePeek);
document.getElementById("peekjump").addEventListener("click", async () => {
  const pid = peekPid;
  closePeek();
  showToast("Finding its terminal…");
  try {
    const res = await fetch(API + "/api/focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid }),
    });
    const out = await res.json();
    showToast(out.focused ? "Jumped to its terminal" : "Couldn't reach Ghostty");
  } catch {
    showToast("Focus failed");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!peekEl.hidden) closePeek();
  else if (selectMode) setSelectMode(false);
  else if (!spawnBar.hidden) setSpawnMode(false);
});
document.getElementById("peeksend").addEventListener("click", sendFromPeek);
document.getElementById("peekinput").addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePeek();
    return;
  }
  e.stopPropagation();
  if (e.key === "Enter") sendFromPeek();
});
async function sendFromPeek() {
  const input = document.getElementById("peekinput");
  const text = input.value.trim();
  if (!text || peekPid == null) return;
  input.value = "";
  const pending = { text, state: "sending" };
  pendingMsgs.push(pending);
  renderPeek(null);
  try {
    const res = await fetch(API + "/api/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pids: [peekPid], text }),
    });
    const { results } = await res.json();
    const r = results[0] || {};
    if (r.queued) {
      // the transcript now carries it as a queued entry — no local copy needed
      pendingMsgs = pendingMsgs.filter((p) => p !== pending);
    } else if (r.sent) {
      pending.state = "sent";
    } else {
      pending.state = "failed";
      setTimeout(() => {
        pendingMsgs = pendingMsgs.filter((p) => p !== pending);
        renderPeek(null);
      }, 5000);
    }
    renderPeek(null);
    setTimeout(refreshPeek, 600);
  } catch {
    pending.state = "failed";
    renderPeek(null);
    showToast("Send failed");
  }
}

grid.addEventListener("click", async (e) => {
  const peekBtn = e.target.closest(".peekbtn");
  if (peekBtn && !selectMode) {
    e.stopPropagation();
    openPeek(Number(peekBtn.dataset.pid));
    return;
  }
  const msgBtn = e.target.closest(".msg");
  if (msgBtn && !selectMode) {
    e.stopPropagation();
    openComposer(msgBtn);
    return;
  }
  const editBtn = e.target.closest(".edit");
  if (editBtn && !selectMode) {
    e.stopPropagation();
    startRename(editBtn);
    return;
  }
  if (selectMode) {
    const el = e.target.closest(".card");
    if (!el) return;
    const pid = Number(el.dataset.pid);
    if (selected.has(pid)) selected.delete(pid);
    else selected.add(pid);
    el.classList.toggle("selected", selected.has(pid));
    el.classList.toggle("selectable", !selected.has(pid));
    updateSendButton();
    return;
  }
  const qd = e.target.closest(".chip.qd");
  if (qd) {
    e.stopPropagation();
    try {
      const res = await fetch(API + "/api/outbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pid: Number(qd.dataset.pid) }),
      });
      const out = await res.json();
      showToast(`Cancelled ${out.cleared} queued message${out.cleared === 1 ? "" : "s"}`);
      lastPayload = "";
      tick();
    } catch {
      showToast("Couldn't cancel");
    }
    return;
  }
  const star = e.target.closest(".star");
  if (star) {
    e.stopPropagation();
    const starred = !star.classList.contains("on");
    star.classList.toggle("on", starred); // optimistic
    try {
      await fetch(API + "/api/star", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: star.dataset.session, starred }),
      });
      lastPayload = ""; // force re-render (and re-section) on next poll
      tick();
    } catch {
      star.classList.toggle("on", !starred);
      showToast("Couldn't save pin");
    }
    return;
  }
  const el = e.target.closest(".card");
  if (!el) return;
  showToast("Finding its terminal…");
  try {
    const res = await fetch(API + "/api/focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid: Number(el.dataset.pid) }),
    });
    const out = await res.json();
    if (out.focused && out.exact) showToast("Jumped to its terminal");
    else if (out.focused) showToast("Jumped to its project window (same folder)");
    else if (out.reason === "automation-permission")
      showToast("macOS blocked it — allow Perch to control Ghostty in System Settings → Privacy → Automation");
    else if (out.reason === "no-surface-match") showToast("Brought Ghostty forward — terminal not found (tmux/ssh?)");
    else showToast("Couldn't reach Ghostty");
  } catch {
    showToast("Focus failed");
  }
});

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

// ---------------------------------------------------------------- analytics

const statsWrap = document.getElementById("stats");
const tabs = document.getElementById("tabs");
const tip = document.getElementById("tip");
let view =
  new URLSearchParams(location.hash.slice(1)).get("view") ||
  localStorage.getItem("perch-view") ||
  "roost";
let statsData = null;
let statsAt = 0;
let lastAgents = [];

function setView(v) {
  view = v;
  localStorage.setItem("perch-view", v);
  for (const b of tabs.querySelectorAll("button")) b.classList.toggle("on", b.dataset.view === v);
  grid.hidden = v !== "roost";
  statsWrap.hidden = v !== "stats";
  if (v === "stats") refreshStats();
}
tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) setView(b.dataset.view);
});

function fmtDur(sec) {
  if (sec == null) return "–";
  if (sec < 60) return Math.round(sec) + "s";
  if (sec < 3600) return Math.round(sec / 60) + "m";
  return Math.floor(sec / 3600) + "h " + Math.round((sec % 3600) / 60) + "m";
}

async function refreshStats() {
  if (Date.now() - statsAt < 60_000 && statsData) return renderStats();
  try {
    const res = await fetch(API + "/api/stats");
    statsData = await res.json();
    statsAt = Date.now();
    renderStats();
  } catch {
    statsWrap.innerHTML = `<div class="empty">Couldn't load stats — is the server running?</div>`;
  }
}

function tile(value, label, sub) {
  return `<div class="tile"><div class="tvalue">${value}</div><div class="tlabel">${esc(label)}</div>${sub ? `<div class="tsub">${esc(sub)}</div>` : ""}</div>`;
}

function dailyChart(days) {
  const W = 660, H = 190, L = 34, R = 6, T = 14, B = 22;
  const pw = W - L - R, ph = H - T - B;
  const max = Math.max(1, ...days.map((d) => d.hours));
  const step = max <= 3 ? 1 : max <= 8 ? 2 : max <= 20 ? 5 : 10;
  const top = Math.ceil(max / step) * step;
  const y = (v) => T + ph - (v / top) * ph;
  const bw = pw / days.length;
  let out = "";
  for (let v = step; v <= top; v += step) {
    out += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/>` +
      `<text x="${L - 5}" y="${y(v) + 3}" class="ax" text-anchor="end">${v}</text>`;
  }
  out += `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" class="bl"/>`;
  const maxIdx = days.reduce((m, d, i) => (d.hours > days[m].hours ? i : m), 0);
  days.forEach((d, i) => {
    const x = L + i * bw + 1;
    const w = Math.max(2, bw - 2);
    const h = Math.max(0, T + ph - y(d.hours));
    const r = Math.min(3, w / 2, h);
    if (d.hours > 0) {
      out += `<path class="bar" data-tip="${esc(d.date)} · ${d.hours}h"
        d="M${x} ${T + ph} v${-(h - r)} q0 ${-r} ${r} ${-r} h${w - 2 * r} q${r} 0 ${r} ${r} v${h - r} z"/>`;
    }
    if ((i === maxIdx || i === days.length - 1) && d.hours > 0) {
      out += `<text x="${x + w / 2}" y="${y(d.hours) - 4}" class="dl" text-anchor="middle">${d.hours}</text>`;
    }
    const dt = new Date(d.date + "T12:00");
    if (dt.getDay() === 1) {
      out += `<text x="${x + w / 2}" y="${H - 6}" class="ax" text-anchor="middle">${dt.getMonth() + 1}/${dt.getDate()}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Agent-hours per day">${out}</svg>`;
}

function waitChart(buckets) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return `<div class="hbars">` + buckets.map((b) => `
    <div class="hrow">
      <span class="hlabel">${esc(b.label)}</span>
      <span class="htrack"><span class="hfill" style="width:${(b.count / max) * 100}%"></span></span>
      <span class="hcount">${b.count}</span>
    </div>`).join("") + `</div>`;
}

function renderStats() {
  if (!statsData) return;
  const { days, waits } = statsData;
  const today = days[days.length - 1];
  const week = days.slice(-7).reduce((s, d) => s + d.hours, 0);
  const waitingNow = lastAgents.filter((a) => a.bucket === "yourturn" || a.bucket === "blocked");
  const oldest = waitingNow.length
    ? Math.max(...waitingNow.map((a) => Date.now() - (a.statusUpdatedAt || Date.now())))
    : null;

  statsWrap.innerHTML = `
    <div class="tiles">
      ${tile(fmtDur(waits.median), "median wait for you", "last 30 days · " + waits.count + " waits")}
      ${tile(fmtDur(waits.p90), "p90 wait", "1 in 10 waits is longer")}
      ${tile(today.hours + "h", "agent-hours today", Math.round(week * 10) / 10 + "h this week")}
      ${tile(String(waitingNow.length), "waiting on you now", oldest != null ? "longest " + fmtDur(oldest / 1000) : "all clear")}
    </div>
    <div class="chartcard">
      <h3>Agent-hours per day <span>last 30 days · parallel agents stack</span></h3>
      ${dailyChart(days)}
      <details><summary>data as table</summary><table>
        <tr><th>date</th><th>hours</th></tr>
        ${days.map((d) => `<tr><td>${esc(d.date)}</td><td>${d.hours}</td></tr>`).join("")}
      </table></details>
    </div>
    <div class="chartcard">
      <h3>How long agents wait on you <span>time from agent done to your next prompt</span></h3>
      ${waitChart(waits.buckets)}
    </div>`;
}

statsWrap.addEventListener("mousemove", (e) => {
  const bar = e.target.closest("[data-tip]");
  if (!bar) { tip.hidden = true; return; }
  tip.textContent = bar.dataset.tip;
  tip.hidden = false;
  tip.style.left = e.pageX + 12 + "px";
  tip.style.top = e.pageY - 28 + "px";
});
statsWrap.addEventListener("mouseleave", () => (tip.hidden = true));

// ---------------------------------------------------------------- demo mode
// #demo=1 renders fabricated agents — for screenshots, store listings, and
// kicking the tires without a server. No API calls are made.

const DEMO = !!new URLSearchParams(location.hash.slice(1)).get("demo");
const now = Date.now();
const DEMO_AGENTS = [
  { pid: 1, sessionId: "demo-1", codename: "Jade Heron", name: "backend-12", avatar: { c: 2, s: 3, seed: 71 },
    project: "~/code/backend", gitBranch: "feat/sso-rollout", tty: "ttys003", model: "claude-fable-5",
    bucket: "blocked", statusLabel: "needs approval", status: "permission",
    title: "Deploy blocked on AWS SSO login", attention: 88, attentionReason: "needs browser auth to proceed",
    lastPrompt: "Ship the SSO rollout to staging and watch the deploy",
    lastAssistant: "The deploy is staged and healthy up to the auth step — I need you to complete the AWS SSO login in your browser, then I'll resume the rollout.",
    contextTokens: 412_000, contextWindow: 1_000_000, contextPct: 41,
    startedAt: now - 26 * 3600e3, statusUpdatedAt: now - 42 * 60e3, updatedAt: now },
  { pid: 2, sessionId: "demo-2", codename: "Copper Owl", name: "api-07", avatar: { c: 1, s: 2, seed: 12 }, starred: true,
    project: "~/code/api", gitBranch: "fix/rate-limits", tty: "ttys001", model: "claude-fable-5",
    bucket: "yourturn", statusLabel: "your turn", status: "idle",
    title: "PR #482 green, awaiting merge", attention: 64, attentionReason: "CI passing, wants your review",
    lastPrompt: "Fix the flaky rate-limit tests and get the PR green",
    lastAssistant: "All 31 checks are passing after pinning the clock in the token-bucket tests. PR #482 is ready for your review and merge.",
    contextTokens: 156_000, contextWindow: 200_000, contextPct: 78,
    startedAt: now - 9 * 3600e3, statusUpdatedAt: now - 18 * 60e3, updatedAt: now },
  { pid: 3, sessionId: "demo-3", codename: "Indigo Finch", name: "web-03", avatar: { c: 0, s: 0, seed: 5 },
    project: "~/code/web", gitBranch: "feat/jwt-migration", tty: "ttys004", model: "claude-fable-5",
    bucket: "working", statusLabel: "working", status: "busy",
    title: "Migrating auth service to JWTs", attention: 8, attentionReason: "working autonomously",
    lastPrompt: "Migrate session auth to JWTs behind the feature flag",
    lastAssistant: "Rotating the signing keys into the KMS wrapper now — 14 of 22 call sites migrated, tests green so far.",
    contextTokens: 88_000, contextWindow: 200_000, contextPct: 44,
    startedAt: now - 3 * 3600e3, statusUpdatedAt: now - 90e3, updatedAt: now },
  { pid: 4, sessionId: "demo-4", codename: "Slate Puffin", name: "infra-22", avatar: { c: 11, s: 10, seed: 33 },
    project: "~/code/infra", gitBranch: "main", tty: "ttys007", model: "claude-fable-5",
    bucket: "working", statusLabel: "shell", status: "shell",
    title: "Auditing dependency tree for CVEs", attention: 21, attentionReason: "context running low",
    lastPrompt: "Audit our dependency tree against last week's CVE batch",
    lastAssistant: "Scanning the lockfiles now — two advisories look relevant so far, both in transitive deps of the image pipeline.",
    contextTokens: 182_000, contextWindow: 200_000, contextPct: 91,
    startedAt: now - 14 * 24 * 3600e3, statusUpdatedAt: now - 30e3, updatedAt: now },
  { pid: 5, sessionId: "demo-5", codename: "Rose Kingfisher", name: "billing-04", avatar: { c: 4, s: 6, seed: 88 },
    project: "~/code/billing", gitBranch: "chore/cron-refactor", tty: "ttys010", model: "claude-fable-5",
    bucket: "yourturn", statusLabel: "your turn", status: "idle",
    title: "Billing cron refactored, awaiting direction", attention: 47, attentionReason: "finished, awaiting next task",
    lastPrompt: "Untangle the retry logic in the invoice cron",
    lastAssistant: "Done — retries now use exponential backoff with a dead-letter queue, and the double-charge window is closed. What's next?",
    contextTokens: 64_000, contextWindow: 200_000, contextPct: 32,
    startedAt: now - 5 * 3600e3, statusUpdatedAt: now - 8 * 60e3, updatedAt: now },
  { pid: 6, sessionId: "demo-6", codename: "Golden Chickadee", name: "web-09", avatar: { c: 3, s: 8, seed: 51 },
    project: "~/code/web", gitBranch: "test/checkout-e2e", tty: "ttys012", model: "claude-fable-5",
    bucket: "working", statusLabel: "working", status: "busy",
    title: "Writing e2e tests for checkout", attention: 6, attentionReason: "working autonomously",
    lastPrompt: "Cover the new checkout flow with e2e tests",
    lastAssistant: "Card-decline and promo-code paths are covered; writing the multi-currency case now.",
    contextTokens: 47_000, contextWindow: 200_000, contextPct: 23,
    startedAt: now - 55 * 60e3, statusUpdatedAt: now - 12e3, updatedAt: now },
];

const DEMO_STATS = {
  days: Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 86400e3);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const base = weekend ? 0.7 : 3.1;
    return {
      date: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"),
      hours: Math.round((base + Math.sin(i * 1.7) * 1.2 + (i % 5) * 0.3) * 10) / 10,
    };
  }),
  waits: {
    count: 512, median: 180, p90: 2400,
    buckets: [
      { label: "under 1m", count: 148 }, { label: "1–5m", count: 197 },
      { label: "5–15m", count: 74 }, { label: "15–60m", count: 58 },
      { label: "1–4h", count: 27 }, { label: "over 4h", count: 8 },
    ],
  },
  generatedAt: now,
};

// --------------------------------------------------------------------- poll

const INSTALL_CMD = "npm install -g perch-dashboard && perch install";

function renderSetup() {
  topstats.innerHTML = "";
  grid.innerHTML = `
  <div class="setup">
    <span class="glyph">🪹</span>
    <h2>Perch server isn't running</h2>
    <p>This page reads your live Claude Code sessions through a tiny local
    server (localhost only, zero dependencies). Install it once and it starts
    on login:</p>
    <div class="cmd"><code>${INSTALL_CMD}</code><button id="copycmd">copy</button></div>
    <p class="alt">Cloned the repo instead? Run <code>node server.mjs install</code>.
    This page checks every few seconds and will light up on its own.</p>
  </div>`;
  document.getElementById("copycmd").addEventListener("click", () => {
    navigator.clipboard.writeText(INSTALL_CMD).then(() => showToast("Copied"));
  });
}

let failCount = 0;

function setDownBanner(down) {
  let banner = document.getElementById("downbanner");
  if (down && !banner) {
    banner = document.createElement("div");
    banner.id = "downbanner";
    banner.className = "downbanner";
    banner.innerHTML = `<span>Perch server stopped — showing stale data. Restart it:</span>
      <code>perch install</code>
      <button id="copyrestart">copy</button>
      <span class="alt">or <code>node server.mjs</code> from the repo</span>`;
    document.body.insertBefore(banner, grid);
    banner.querySelector("#copyrestart").addEventListener("click", () => {
      navigator.clipboard.writeText("perch install").then(() => showToast("Copied"));
    });
  } else if (!down && banner) {
    banner.remove();
  }
}

async function tick() {
  if (DEMO) {
    lastAgents = DEMO_AGENTS;
    statsData = DEMO_STATS;
    statsAt = Date.now();
    render(DEMO_AGENTS);
    if (view === "stats") renderStats();
    freshness.textContent = "demo data";
    return;
  }
  try {
    const res = await fetch(API + "/api/agents");
    const data = await res.json();
    failCount = 0;
    setDownBanner(false);
    lastAgents = data.agents;
    if (editing) return; // don't clobber an in-progress rename
    const payload = JSON.stringify(data.agents);
    if (payload !== lastPayload) {
      lastPayload = payload;
      render(data.agents);
      if (view === "stats") renderStats(); // "waiting on you now" tile is live
    }
    if (view === "stats") refreshStats();
    freshness.textContent = "live · updated " + new Date(data.generatedAt).toLocaleTimeString();
  } catch {
    failCount++;
    // Onboard when we never had data; banner over stale data when it dies later.
    if (!lastPayload) renderSetup();
    else if (failCount >= 3) setDownBanner(true);
    freshness.textContent = "server unreachable — is perch running?";
  }
}

setView(view);
tick().then(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("bcast")) setSelectMode(true);
  if (params.get("peek")) openPeek(Number(params.get("peek")));
});
setInterval(tick, POLL_MS);

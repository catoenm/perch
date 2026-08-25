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

const PLUMAGE = [
  ["#3987e5", "#1c5cab"], ["#d95926", "#9c3a12"], ["#199e70", "#0c6b4a"],
  ["#c98500", "#8f5e00"], ["#d55181", "#a02c58"], ["#008300", "#005700"],
  ["#9085e9", "#5c4fc0"], ["#e66767", "#b13030"],
];

function birdSvg(seed) {
  const h = hashCode(seed);
  const pick = (n, m) => (h >>> n) % m;
  const [body, dark] = PLUMAGE[pick(0, PLUMAGE.length)];
  const r = 15 + pick(3, 5);            // body radius
  const tilt = -14 + pick(6, 5) * 7;    // wing tilt
  const tuft = pick(9, 3);              // head feathers 0–2
  const cy = 47 - r;
  const tufts = Array.from({ length: tuft + 1 }, (_, i) => {
    const x = 26 + i * 5;
    return `<path d="M${x} ${cy - r + 2} q ${i - 1} -7 ${(i - 1) * 4 - 2} -9" stroke="${dark}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }).join("");
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <rect width="64" height="64" fill="${body}" opacity="0.13"/>
    <path d="M8 52h48" stroke="${dark}" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>
    <line x1="27" y1="${cy + r - 3}" x2="27" y2="52" stroke="${dark}" stroke-width="2"/>
    <line x1="35" y1="${cy + r - 3}" x2="35" y2="52" stroke="${dark}" stroke-width="2"/>
    ${tufts}
    <circle cx="31" cy="${cy}" r="${r}" fill="${body}"/>
    <ellipse cx="${28 - r / 4}" cy="${cy + 3}" rx="${r * 0.55}" ry="${r * 0.4}" fill="${dark}" transform="rotate(${tilt} ${28 - r / 4} ${cy + 3})"/>
    <circle cx="${31 + r * 0.45}" cy="${cy - r * 0.35}" r="2.2" fill="#0b0b0b"/>
    <circle cx="${31 + r * 0.45 + 0.7}" cy="${cy - r * 0.35 - 0.7}" r="0.7" fill="#ffffff"/>
    <path d="M${31 + r - 1} ${cy - r * 0.18} l7 2.4 -7 2.4z" fill="${dark}"/>
  </svg>`;
}

// ---------------------------------------------------------------- rendering

let lastPayload = "";

function card(agent) {
  const pct = agent.contextPct;
  const fillClass = pct >= 92 ? "crit" : pct >= 80 ? "warn" : "";
  const needsYou = agent.attention >= NEEDS_YOU;
  const whyClass = agent.attention >= 70 ? "crit" : needsYou ? "warn" : "";
  return `
  <article class="card ${agent.bucket === "working" || needsYou ? "" : "dim"}" data-pid="${agent.pid}" title="Click to jump to this Ghostty terminal">
    <div class="card-top">
      <div class="avatar">${birdSvg(agent.sessionId)}</div>
      <div class="idcol">
        <h2>${esc(agent.title || agent.lastPrompt || agent.name)}</h2>
        <div class="path">${esc(agent.name)} · ${esc(agent.project)}${agent.gitBranch && agent.gitBranch !== "HEAD" ? " · " + esc(agent.gitBranch) : ""}</div>
      </div>
      <div class="pill s-${agent.bucket}"><span class="dot"></span>${esc(agent.statusLabel)}</div>
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
      <span class="chip">${esc(agent.tty || "?")}</span>
      <span class="chip">up ${ago(agent.startedAt)}</span>
      <span class="chip">${esc(agent.statusLabel)} for ${ago(agent.statusUpdatedAt)}</span>
    </div>
  </article>`;
}

function section(label, agents) {
  if (!agents.length) return "";
  return `<h3 class="section">${label} <span>${agents.length}</span></h3>` + agents.map(card).join("");
}

function render(agents) {
  const byScore = (a, b) => b.attention - a.attention;
  const needsYou = agents.filter((a) => a.attention >= NEEDS_YOU).sort(byScore);
  const working = agents
    .filter((a) => a.attention < NEEDS_YOU && a.bucket === "working")
    .sort(byScore);
  const rest = agents
    .filter((a) => a.attention < NEEDS_YOU && a.bucket !== "working")
    .sort(byScore);

  const next = needsYou[0];
  topstats.innerHTML = agents.length
    ? next
      ? `next up: <b>${esc(next.title || next.name)}</b> — ${esc(next.attentionReason)}`
      : `<b>${agents.length}</b> on the perch · all working, nothing needs you 🎉`
    : "";

  grid.innerHTML = agents.length
    ? section("Needs you", needsYou) + section("Working", working) + section("Parked", rest)
    : `<div class="empty"><span class="glyph">🪹</span>No agents on the perch.<br>Start one with <code>claude</code> and it will appear here.</div>`;
}

// ------------------------------------------------------------------ events

grid.addEventListener("click", async (e) => {
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

async function tick() {
  try {
    const res = await fetch(API + "/api/agents");
    const data = await res.json();
    const payload = JSON.stringify(data.agents);
    if (payload !== lastPayload) {
      lastPayload = payload;
      render(data.agents);
    }
    freshness.textContent = "live · updated " + new Date(data.generatedAt).toLocaleTimeString();
  } catch {
    // Keep showing the last good data on a blip; onboard when we never had any.
    if (!lastPayload) renderSetup();
    freshness.textContent = "server unreachable — is perch running?";
  }
}

tick();
setInterval(tick, POLL_MS);

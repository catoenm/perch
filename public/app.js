/* Perch frontend — polls /api/agents, renders the roost. */

const POLL_MS = 3000;
const grid = document.getElementById("grid");
const topstats = document.getElementById("topstats");
const freshness = document.getElementById("freshness");
const toast = document.getElementById("toast");

// ------------------------------------------------------------ status model

const STATUS = {
  busy: { bucket: "working", label: "working" },
  shell: { bucket: "working", label: "shell" },
  compacting: { bucket: "working", label: "compacting" },
  thinking: { bucket: "working", label: "working" },
  idle: { bucket: "yourturn", label: "your turn" },
  ready: { bucket: "yourturn", label: "your turn" },
  waiting: { bucket: "yourturn", label: "your turn" },
  permission: { bucket: "blocked", label: "needs approval" },
  needs_permission: { bucket: "blocked", label: "needs approval" },
  notification: { bucket: "blocked", label: "pinged you" },
};

function statusInfo(raw) {
  return STATUS[raw] || { bucket: "other", label: raw || "unknown" };
}

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

const BUCKET_ORDER = { working: 0, blocked: 1, yourturn: 2, other: 3 };
let lastPayload = "";

function card(agent) {
  const info = statusInfo(agent.status);
  const pct = agent.contextTokens != null
    ? Math.min(100, Math.round((agent.contextTokens / agent.contextWindow) * 100))
    : null;
  const fillClass = pct >= 92 ? "crit" : pct >= 80 ? "warn" : "";
  const dim = info.bucket === "yourturn" || info.bucket === "other";
  return `
  <article class="card ${dim ? "dim" : ""}" data-pid="${agent.pid}" title="Click to jump to this Ghostty window">
    <div class="card-top">
      <div class="avatar">${birdSvg(agent.sessionId)}</div>
      <div class="idcol">
        <h2>${esc(agent.name)}</h2>
        <div class="path">${esc(agent.project)}${agent.gitBranch && agent.gitBranch !== "HEAD" ? " · " + esc(agent.gitBranch) : ""}</div>
      </div>
      <div class="pill s-${info.bucket}"><span class="dot"></span>${esc(info.label)}</div>
    </div>
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
      <span class="chip">${esc(info.label)} for ${ago(agent.statusUpdatedAt)}</span>
    </div>
  </article>`;
}

function render(agents) {
  const sorted = [...agents].sort((a, b) => {
    const ba = BUCKET_ORDER[statusInfo(a.status).bucket];
    const bb = BUCKET_ORDER[statusInfo(b.status).bucket];
    if (ba !== bb) return ba - bb;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  const working = agents.filter((a) => statusInfo(a.status).bucket === "working").length;
  const waiting = agents.filter((a) => statusInfo(a.status).bucket === "yourturn").length;
  topstats.innerHTML = agents.length
    ? `<b>${agents.length}</b> on the perch · <b>${working}</b> working${waiting ? ` · <b>${waiting}</b> waiting on you` : ""}`
    : "";

  grid.innerHTML = sorted.length
    ? sorted.map(card).join("")
    : `<div class="empty"><span class="glyph">🪹</span>No agents on the perch.<br>Start one with <code>claude</code> and it will appear here.</div>`;
}

// ------------------------------------------------------------------ events

grid.addEventListener("click", async (e) => {
  const el = e.target.closest(".card");
  if (!el) return;
  showToast("Looking for its window…");
  try {
    const res = await fetch("/api/focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid: Number(el.dataset.pid) }),
    });
    const out = await res.json();
    if (out.focused) showToast("Jumped to " + (out.title || "Ghostty"));
    else if (out.reason === "no-window-match") showToast("Brought Ghostty forward — couldn't match the exact window");
    else if (out.reason === "accessibility") showToast("Grant Accessibility to Perch's node process to jump to exact windows");
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
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

// --------------------------------------------------------------------- poll

async function tick() {
  try {
    const res = await fetch("/api/agents");
    const data = await res.json();
    const payload = JSON.stringify(data.agents);
    if (payload !== lastPayload) {
      lastPayload = payload;
      render(data.agents);
    }
    freshness.textContent = "live · updated " + new Date(data.generatedAt).toLocaleTimeString();
  } catch {
    freshness.textContent = "server unreachable — is perch running?";
  }
}

tick();
setInterval(tick, POLL_MS);

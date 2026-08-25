#!/usr/bin/env node
// Perch — a calm view over every Claude agent you have running.
// Zero dependencies. Reads Claude Code's own session state from ~/.claude.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PERCH_PORT || 4242);
const HOST = "127.0.0.1";
const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const PUBLIC_DIR = path.join(__dirname, "public");
const TAIL_BYTES = 512 * 1024;
const CACHE_MS = 2000;

// ---------------------------------------------------------------- utilities

function exec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      // ps exits non-zero when some pids are gone; its stdout is still valid.
      resolve(stdout || "");
    });
  });
}

function slugForCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

async function readTail(file, bytes = TAIL_BYTES) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // drop the partial first line
    return lines.filter(Boolean);
  } finally {
    await handle.close();
  }
}

function stripNoise(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, " ")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, " ")
    .replace(/<command-args>([\s\S]*?)<\/command-args>/g, " $1")
    .replace(/<command-name>([\s\S]*?)<\/command-name>/g, "$1")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && block.text)
    .map((block) => block.text)
    .join(" ");
}

function snippet(text, max = 280) {
  const clean = stripNoise(text);
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

// -------------------------------------------------------------- data layer

async function liveClaudeProcs() {
  // pid -> tty for every live process whose args mention claude
  const out = await exec("ps", ["-axww", "-o", "pid=,tty=,args="]);
  const procs = new Map();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, tty, args] = m;
    if (/^(\S*\/)?claude(\s|$)/.test(args)) procs.set(Number(pid), tty);
  }
  return procs;
}

async function parseTranscript(cwd, sessionId) {
  const file = path.join(PROJECTS_DIR, slugForCwd(cwd), sessionId + ".jsonl");
  const result = {
    model: null,
    contextTokens: null,
    gitBranch: null,
    lastPrompt: null,
    lastPromptAt: null,
    lastAssistant: null,
    transcriptMtime: null,
  };
  let lines;
  try {
    result.transcriptMtime = (await fs.stat(file)).mtimeMs;
    lines = await readTail(file);
  } catch {
    return result; // no transcript yet
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.isSidechain) continue;

    if (result.gitBranch === null && entry.gitBranch) {
      result.gitBranch = entry.gitBranch;
    }

    if (entry.type === "assistant" && entry.message) {
      if (result.model === null && entry.message.model) {
        result.model = entry.message.model;
      }
      const usage = entry.message.usage;
      if (result.contextTokens === null && usage && usage.input_tokens != null) {
        result.contextTokens =
          (usage.input_tokens || 0) +
          (usage.cache_read_input_tokens || 0) +
          (usage.cache_creation_input_tokens || 0);
      }
      if (result.lastAssistant === null) {
        const text = textFromContent(entry.message.content);
        if (text.trim()) result.lastAssistant = snippet(text);
      }
    }

    if (entry.type === "user" && entry.message && result.lastPrompt === null) {
      const human =
        entry.origin?.kind === "human" ||
        entry.promptSource === "typed" ||
        typeof entry.message.content === "string";
      if (human) {
        const text = snippet(textFromContent(entry.message.content), 220);
        if (text) {
          result.lastPrompt = text;
          result.lastPromptAt = entry.timestamp || null;
        }
      }
    }

    if (
      result.model !== null &&
      result.contextTokens !== null &&
      result.lastPrompt !== null &&
      result.lastAssistant !== null &&
      result.gitBranch !== null
    ) {
      break;
    }
  }
  return result;
}

async function collectAgents() {
  let files;
  try {
    files = await fs.readdir(SESSIONS_DIR);
  } catch {
    return [];
  }
  const procs = await liveClaudeProcs();

  const agents = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        let session;
        try {
          session = JSON.parse(
            await fs.readFile(path.join(SESSIONS_DIR, f), "utf8")
          );
        } catch {
          return null;
        }
        if (!session.pid || !procs.has(session.pid)) return null; // stale file
        const transcript = await parseTranscript(session.cwd, session.sessionId);
        const contextWindow =
          transcript.contextTokens > 195_000 ? 1_000_000 : 200_000;
        return {
          pid: session.pid,
          sessionId: session.sessionId,
          name: session.name || path.basename(session.cwd),
          cwd: session.cwd,
          project: session.cwd.replace(os.homedir(), "~"),
          tty: procs.get(session.pid),
          status: session.status || "unknown",
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
          statusUpdatedAt: session.statusUpdatedAt,
          version: session.version,
          kind: session.kind,
          ...transcript,
          contextWindow: transcript.contextTokens != null ? contextWindow : null,
        };
      })
  );
  return agents.filter(Boolean);
}

let cache = { at: 0, promise: null };
function agentsCached() {
  const now = Date.now();
  if (!cache.promise || now - cache.at > CACHE_MS) {
    cache = { at: now, promise: collectAgents() };
  }
  return cache.promise;
}

// ------------------------------------------------------------ ghostty focus

const FOCUS_JXA = `
function run(argv) {
  const cands = argv.map(s => s.toLowerCase()).filter(Boolean);
  Application("Ghostty").activate();
  try {
    const proc = Application("System Events").processes.byName("Ghostty");
    const wins = proc.windows();
    for (const cand of cands) {
      for (let i = 0; i < wins.length; i++) {
        const title = (wins[i].name() || "").toLowerCase();
        if (title.includes(cand)) {
          wins[i].actions.byName("AXRaise").perform();
          return JSON.stringify({ focused: true, title: wins[i].name() });
        }
      }
    }
    return JSON.stringify({ focused: false, reason: "no-window-match" });
  } catch (e) {
    return JSON.stringify({ focused: false, reason: "accessibility" });
  }
}`;

async function focusAgent(pid) {
  const agents = await agentsCached();
  const agent = agents.find((a) => a.pid === pid);
  if (!agent) return { focused: false, reason: "not-found" };
  const candidates = [
    agent.name,
    path.basename(agent.cwd),
    agent.sessionId.slice(0, 8),
  ].filter(Boolean);
  const out = await exec("osascript", ["-l", "JavaScript", "-e", FOCUS_JXA, ...candidates]);
  try {
    return JSON.parse(out.trim());
  } catch {
    return { focused: false, reason: "osascript-failed" };
  }
}

// ------------------------------------------------------------------ server

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (pathname === "/api/agents") {
      const agents = await agentsCached();
      return sendJson(res, 200, { agents, generatedAt: Date.now() });
    }
    if (pathname === "/api/focus" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { pid } = JSON.parse(body || "{}");
      return sendJson(res, 200, await focusAgent(Number(pid)));
    }
    // static
    const rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.join(PUBLIC_DIR, path.normalize(rel));
    if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 404, { error: "not found" });
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      return res.end(data);
    } catch {
      return sendJson(res, 404, { error: "not found" });
    }
  } catch (err) {
    return sendJson(res, 500, { error: String(err) });
  }
});

// -------------------------------------------------------- launchd (install)

const PLIST_LABEL = "app.perch.dashboard";
const PLIST_PATH = path.join(
  os.homedir(),
  "Library/LaunchAgents",
  PLIST_LABEL + ".plist"
);

function plist() {
  const log = path.join(os.homedir(), "Library/Logs/perch.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(__dirname, "server.mjs")}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`;
}

async function install() {
  await fs.mkdir(path.dirname(PLIST_PATH), { recursive: true });
  await fs.writeFile(PLIST_PATH, plist());
  await exec("launchctl", ["unload", PLIST_PATH]);
  await exec("launchctl", ["load", PLIST_PATH]);
  console.log(`Perch installed as a LaunchAgent (${PLIST_LABEL}).`);
  console.log(`It is now running at http://localhost:${PORT} and will start on login.`);
}

async function uninstall() {
  await exec("launchctl", ["unload", PLIST_PATH]);
  await fs.rm(PLIST_PATH, { force: true });
  console.log("Perch LaunchAgent removed.");
}

const command = process.argv[2];
if (command === "install") {
  install();
} else if (command === "uninstall") {
  uninstall();
} else {
  server.listen(PORT, HOST, () => {
    console.log(`Perch is watching from http://localhost:${PORT}`);
  });
}

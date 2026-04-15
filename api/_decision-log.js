export const CSV_HEADER = "czas_zdarzenia_s,decyzja\n";
export const USER_LOG_CSV_HEADER = "czas_zdarzenia_s,decyzja,session_id\n";
export const LOG_CHUNK_PREFIX = "decision-logs/chunks/";

function escapeCsv(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function normalizeNick(value) {
  const nick = String(value ?? "").trim().replace(/[\r\n]+/g, " ");
  if (!nick) return "";
  return nick.slice(0, 64);
}

function normalizeSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId) return "";
  return sessionId.slice(0, 80);
}

function parseLegacyNick(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return normalizeNick(value.slice(1, -1).replace(/""/g, '"'));
  }
  return normalizeNick(value);
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("payload-too-large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function parseEntriesFromRequest(req) {
  const rawBody = await readRawBody(req);
  const payload = rawBody ? JSON.parse(rawBody) : {};
  return Array.isArray(payload?.entries) ? payload.entries : [];
}

export function normalizeIncomingEntries(entries) {
  if (!Array.isArray(entries)) return [];

  const normalized = [];
  const fallbackLoggedAt = new Date().toISOString();
  for (const entry of entries) {
    const loggedAt = typeof entry?.loggedAt === "string" && entry.loggedAt ? entry.loggedAt : fallbackLoggedAt;
    if (entry?.type === "nick") {
      const nick = normalizeNick(entry.nick);
      if (!nick) continue;
      normalized.push({
        type: "nick",
        nick,
        sessionId: normalizeSessionId(entry.sessionId),
        loggedAt,
      });
      continue;
    }

    const elapsedMs = Math.max(0, Math.round(Number(entry?.elapsedMs) || 0));
    const decision = Number(entry?.decision) === 1 ? 1 : 0;
    normalized.push({
      type: "decision",
      elapsedMs,
      decision,
      nick: normalizeNick(entry?.nick),
      sessionId: normalizeSessionId(entry?.sessionId),
      loggedAt,
    });
  }

  return normalized;
}

export function toCsvRows(entries) {
  if (!Array.isArray(entries)) return [];

  const rows = [];
  for (const entry of entries) {
    if (entry?.type === "nick") {
      const nick = normalizeNick(entry?.nick);
      if (nick) rows.push(`nick,${escapeCsv(nick)}`);
      continue;
    }

    if (entry?.type !== "decision") continue;
    const elapsedMs = Math.max(0, Number(entry?.elapsedMs) || 0);
    const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
    const decision = Number(entry?.decision) === 1 ? 1 : 0;
    rows.push(`${elapsedSeconds},${decision}`);
  }

  return rows;
}

export function parseLegacyCsvChunk(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const entries = [];
  let activeNick = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "czas_zdarzenia_s,decyzja" || trimmed === "czas_zdarzenia_ms,decyzja") {
      continue;
    }

    if (trimmed.startsWith("nick,")) {
      activeNick = parseLegacyNick(trimmed.slice(5));
      entries.push({
        type: "nick",
        nick: activeNick,
        sessionId: "",
        loggedAt: null,
      });
      continue;
    }

    const match = trimmed.match(/^(-?\d+(?:\.\d+)?),([01])$/);
    if (!match) continue;
    const elapsedSeconds = Number(match[1]) || 0;
    const elapsedMs = Math.max(0, Math.round(elapsedSeconds * 1000));
    entries.push({
      type: "decision",
      elapsedMs,
      decision: match[2] === "1" ? 1 : 0,
      nick: activeNick,
      sessionId: "",
      loggedAt: null,
    });
  }
  return entries;
}

export function buildUsersSummary(entries) {
  const usersMap = new Map();
  for (const entry of entries) {
    const nick = normalizeNick(entry?.nick);
    if (!nick) continue;

    const existing =
      usersMap.get(nick) ??
      {
        nick,
        sessions: new Set(),
        totalDecisions: 0,
        ones: 0,
        zeros: 0,
        lastSeen: null,
      };

    const sessionId = normalizeSessionId(entry?.sessionId);
    if (sessionId) existing.sessions.add(sessionId);
    if (entry?.type === "decision") {
      existing.totalDecisions += 1;
      if (entry.decision === 1) existing.ones += 1;
      if (entry.decision === 0) existing.zeros += 1;
    }

    const loggedAt = entry?.loggedAt ? String(entry.loggedAt) : null;
    if (loggedAt && (!existing.lastSeen || loggedAt > existing.lastSeen)) {
      existing.lastSeen = loggedAt;
    }

    usersMap.set(nick, existing);
  }

  return [...usersMap.values()]
    .map((user) => ({
      nick: user.nick,
      sessions: user.sessions.size,
      totalDecisions: user.totalDecisions,
      ones: user.ones,
      zeros: user.zeros,
      lastSeen: user.lastSeen,
    }))
    .sort((a, b) => b.totalDecisions - a.totalDecisions || a.nick.localeCompare(b.nick));
}

export function buildUserDecisionRows(entries, nick) {
  const targetNick = normalizeNick(nick);
  if (!targetNick) return [];

  const rows = [];
  for (const entry of entries) {
    if (entry?.type !== "decision") continue;
    if (normalizeNick(entry?.nick) !== targetNick) continue;
    const elapsedMs = Math.max(0, Number(entry?.elapsedMs) || 0);
    rows.push({
      seconds: (elapsedMs / 1000).toFixed(1),
      decision: entry.decision === 1 ? 1 : 0,
      sessionId: normalizeSessionId(entry?.sessionId),
      loggedAt: entry?.loggedAt ? String(entry.loggedAt) : "",
    });
  }

  rows.sort((a, b) => {
    const byLoggedAt = a.loggedAt.localeCompare(b.loggedAt);
    if (byLoggedAt !== 0) return byLoggedAt;
    return Number(a.seconds) - Number(b.seconds);
  });

  return rows;
}

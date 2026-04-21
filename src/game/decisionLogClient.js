const DECISION_LOG_ENDPOINT = "/api/decision-log";
const DECISION_CHUNK_ENDPOINT = "/api/decision-log-decisions";
const LOCAL_DECISION_LOG_STORAGE_KEY = "goldminer:decision-detail:v1";
const MAX_LOCAL_DECISION_ROWS = 12000;
const MAX_PENDING_RUN_SUMMARIES = 128;
const MAX_PENDING_DECISION_CHUNKS = 256;
const FLUSH_DEBOUNCE_MS = 220;

let localDecisionRows = loadLocalDecisionRows();
let pendingRunSummaries = [];
let isFlushing = false;
let retryTimer = 0;
let scheduledFlushTimer = 0;
let scheduledPersistTimer = 0;

let pendingDecisionChunks = [];
let isFlushingDecisionChunks = false;
let decisionRetryTimer = 0;
let decisionFlushTimer = 0;

let activeNick = "";
let activeSessionId = "";
let activeSessionStartedAt = "";
let activeSessionClosed = false;
let sessionDecisionRows = [];
let syncedDecisionRowCount = 0;
let enqueuedDecisionRowCount = 0;

function hasBrowserStorage() {
  return typeof globalThis !== "undefined" && typeof globalThis.localStorage !== "undefined";
}

function createSessionId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeNick(nick) {
  const value = String(nick ?? "").trim().replace(/[\r\n]+/g, " ");
  if (!value) return "";
  return value.slice(0, 64);
}

function normalizeSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId) return "";
  return sessionId.slice(0, 120);
}

function normalizeIsoDate(value, fallback = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return parsed.toISOString();
}

function toNonNegativeInt(value, fallback = 0) {
  return Math.max(0, Math.round(Number(value) || fallback));
}

function loadLocalDecisionRows() {
  if (!hasBrowserStorage()) return [];
  try {
    const raw = globalThis.localStorage.getItem(LOCAL_DECISION_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((entry) => ({
        nick: normalizeNick(entry?.nick),
        sessionId: normalizeSessionId(entry?.sessionId),
        elapsedMs: toNonNegativeInt(entry?.elapsedMs),
        decision: Number(entry?.decision) === 1 ? 1 : 0,
        loggedAt: normalizeIsoDate(entry?.loggedAt, ""),
      }))
      .filter((entry) => entry.nick && entry.sessionId && entry.loggedAt)
      .slice(-MAX_LOCAL_DECISION_ROWS);
  } catch {
    return [];
  }
}

function scheduleLocalPersist() {
  if (!hasBrowserStorage() || scheduledPersistTimer) return;
  scheduledPersistTimer = globalThis.setTimeout(() => {
    scheduledPersistTimer = 0;
    try {
      globalThis.localStorage.setItem(
        LOCAL_DECISION_LOG_STORAGE_KEY,
        JSON.stringify(localDecisionRows.slice(-MAX_LOCAL_DECISION_ROWS))
      );
    } catch {
      // Ignore storage write failures (quota/private mode)
    }
  }, 250);
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = globalThis.setTimeout(() => {
    retryTimer = 0;
    void flushRunSummaries();
  }, 1500);
}

function scheduleFlush(delayMs = FLUSH_DEBOUNCE_MS) {
  if (scheduledFlushTimer) return;
  scheduledFlushTimer = globalThis.setTimeout(() => {
    scheduledFlushTimer = 0;
    void flushRunSummaries();
  }, Math.max(0, Math.round(delayMs)));
}

function scheduleDecisionRetry() {
  if (decisionRetryTimer) return;
  decisionRetryTimer = globalThis.setTimeout(() => {
    decisionRetryTimer = 0;
    void flushDecisionChunks();
  }, 1500);
}

function scheduleDecisionFlush(delayMs = 0) {
  if (decisionFlushTimer) return;
  decisionFlushTimer = globalThis.setTimeout(() => {
    decisionFlushTimer = 0;
    void flushDecisionChunks();
  }, Math.max(0, Math.round(delayMs)));
}

async function flushRunSummaries() {
  if (isFlushing || pendingRunSummaries.length === 0) return;
  isFlushing = true;

  if (scheduledFlushTimer) {
    globalThis.clearTimeout(scheduledFlushTimer);
    scheduledFlushTimer = 0;
  }

  const nextSummary = pendingRunSummaries[0];
  try {
    const response = await fetch(DECISION_LOG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ runSummary: nextSummary }),
    });

    if (!response.ok) {
      throw new Error(`Run summary request failed: ${response.status}`);
    }

    pendingRunSummaries = pendingRunSummaries.slice(1);
  } catch {
    scheduleRetry();
  } finally {
    isFlushing = false;
    if (pendingRunSummaries.length > 0 && !retryTimer) {
      void flushRunSummaries();
    }
  }
}

async function flushDecisionChunks() {
  if (isFlushingDecisionChunks || pendingDecisionChunks.length === 0) return;
  isFlushingDecisionChunks = true;

  if (decisionFlushTimer) {
    globalThis.clearTimeout(decisionFlushTimer);
    decisionFlushTimer = 0;
  }

  const nextChunk = pendingDecisionChunks[0];
  try {
    const response = await fetch(DECISION_CHUNK_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        nick: nextChunk.nick,
        sessionId: nextChunk.sessionId,
        chunkId: nextChunk.chunkId,
        rows: nextChunk.rows,
      }),
    });

    if (!response.ok) {
      throw new Error(`Decision chunk request failed: ${response.status}`);
    }

    pendingDecisionChunks = pendingDecisionChunks.slice(1);
    if (nextChunk.sessionId === activeSessionId) {
      syncedDecisionRowCount = Math.max(syncedDecisionRowCount, nextChunk.endIndex);
    }
  } catch {
    scheduleDecisionRetry();
  } finally {
    isFlushingDecisionChunks = false;
    if (pendingDecisionChunks.length > 0 && !decisionRetryTimer) {
      void flushDecisionChunks();
    }
  }
}

function appendLocalDecisionEntry(entry) {
  localDecisionRows.push(entry);
  if (localDecisionRows.length > MAX_LOCAL_DECISION_ROWS) {
    localDecisionRows = localDecisionRows.slice(-MAX_LOCAL_DECISION_ROWS);
  }
  scheduleLocalPersist();
}

function normalizeDecisionEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const elapsedMs = Math.max(0, Math.round(Number(entry.elapsedMs) || 0));
  const decision = Number(entry.decision) === 1 ? 1 : 0;
  return {
    elapsedMs,
    decision,
    loggedAt: new Date().toISOString(),
  };
}

function normalizeRunHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry) => ({
      level: toNonNegativeInt(entry?.level),
      goal: toNonNegativeInt(entry?.goal),
      earned: toNonNegativeInt(entry?.earned),
      reward: toNonNegativeInt(entry?.reward),
      oneDecisions: toNonNegativeInt(entry?.oneDecisions),
      zeroDecisions: toNonNegativeInt(entry?.zeroDecisions),
      success: Boolean(entry?.success),
    }))
    .filter((entry) => entry.level > 0)
    .sort((a, b) => a.level - b.level)
    .slice(0, 32);
}

function buildRunSummary(snapshot, endedPhase) {
  const phase = endedPhase === "run-complete" ? "run-complete" : "level-failed";
  const oneDecisions = toNonNegativeInt(snapshot?.runOneDecisions, toNonNegativeInt(snapshot?.oneDecisions));
  const zeroDecisions = toNonNegativeInt(snapshot?.runZeroDecisions, toNonNegativeInt(snapshot?.zeroDecisions));
  const totalDecisions = oneDecisions + zeroDecisions;
  const totalLevels = Math.max(1, toNonNegativeInt(snapshot?.totalLevels, 1));
  const lastLevel = Math.max(1, toNonNegativeInt(snapshot?.level, 1));
  const completedLevels = phase === "run-complete" ? totalLevels : Math.max(0, lastLevel - 1);

  return {
    version: 3,
    kind: "run-summary",
    nick: activeNick,
    sessionId: activeSessionId,
    startedAt: normalizeIsoDate(activeSessionStartedAt, new Date().toISOString()),
    finishedAt: new Date().toISOString(),
    endedPhase: phase,
    success: phase === "run-complete",
    completedLevels,
    lastLevel,
    totalDecisions,
    ones: oneDecisions,
    zeros: zeroDecisions,
    totalEarned: toNonNegativeInt(snapshot?.stats?.totalEarned),
    bank: toNonNegativeInt(snapshot?.bank),
    history: normalizeRunHistory(snapshot?.history),
  };
}

function toSignature(summary) {
  return `${summary.sessionId}#${summary.finishedAt}`;
}

function isSummaryAlreadyQueued(summary) {
  const signature = toSignature(summary);
  return pendingRunSummaries.some((item) => toSignature(item) === signature);
}

function queueRunSummary(summary) {
  if (!summary || !summary.sessionId || !summary.nick) return;
  if (isSummaryAlreadyQueued(summary)) return;

  pendingRunSummaries.push(summary);
  if (pendingRunSummaries.length > MAX_PENDING_RUN_SUMMARIES) {
    pendingRunSummaries = pendingRunSummaries.slice(-MAX_PENDING_RUN_SUMMARIES);
  }
  scheduleFlush(0);
}

function toChunkId(sessionId, startIndex, endIndex) {
  return `${sessionId}:${startIndex}-${endIndex}`;
}

function queueDecisionChunk(startIndex, endIndex, rows) {
  if (!activeNick || !activeSessionId) return;
  if (!Array.isArray(rows) || rows.length === 0) return;

  pendingDecisionChunks.push({
    nick: activeNick,
    sessionId: activeSessionId,
    chunkId: toChunkId(activeSessionId, startIndex, endIndex),
    startIndex,
    endIndex,
    rows,
  });
  if (pendingDecisionChunks.length > MAX_PENDING_DECISION_CHUNKS) {
    pendingDecisionChunks = pendingDecisionChunks.slice(-MAX_PENDING_DECISION_CHUNKS);
  }
  scheduleDecisionFlush(0);
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function appendDecisionEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  if (!activeNick || !activeSessionId) return;

  for (const entry of entries) {
    const normalized = normalizeDecisionEntry(entry);
    if (!normalized) continue;
    sessionDecisionRows.push({
      elapsedMs: normalized.elapsedMs,
      decision: normalized.decision,
    });
    appendLocalDecisionEntry({
      nick: activeNick,
      sessionId: activeSessionId,
      elapsedMs: normalized.elapsedMs,
      decision: normalized.decision,
      loggedAt: normalized.loggedAt,
    });
  }
}

export function startDecisionSession(nick) {
  const normalizedNick = normalizeNick(nick);
  if (!normalizedNick) return;

  activeNick = normalizedNick;
  activeSessionId = createSessionId();
  activeSessionStartedAt = new Date().toISOString();
  activeSessionClosed = false;
  sessionDecisionRows = [];
  syncedDecisionRowCount = 0;
  enqueuedDecisionRowCount = 0;
}

export function syncDecisionRowsChunk() {
  if (!activeNick || !activeSessionId) return;
  const totalRows = sessionDecisionRows.length;
  if (totalRows <= enqueuedDecisionRowCount) return;

  const startIndex = enqueuedDecisionRowCount;
  const endIndex = totalRows;
  const rows = sessionDecisionRows.slice(startIndex, endIndex).map((entry) => ({
    elapsedMs: toNonNegativeInt(entry?.elapsedMs),
    decision: Number(entry?.decision) === 1 ? 1 : 0,
  }));
  if (rows.length === 0) return;

  enqueuedDecisionRowCount = endIndex;
  queueDecisionChunk(startIndex, endIndex, rows);
}

export function finalizeDecisionSession(snapshot, endedPhase) {
  if (!activeNick || !activeSessionId || activeSessionClosed) return;
  if (endedPhase !== "run-complete" && endedPhase !== "level-failed") return;

  syncDecisionRowsChunk();
  const summary = buildRunSummary(snapshot, endedPhase);
  activeSessionClosed = true;
  queueRunSummary(summary);
}

export function getLocalDecisionExportCount() {
  return localDecisionRows.length;
}

export function exportLocalDecisionCsv() {
  if (!Array.isArray(localDecisionRows) || localDecisionRows.length === 0) return false;

  const header = "timestamp_iso,nick,session_id,czas_zdarzenia_s,decyzja\n";
  const rows = localDecisionRows.map((entry) =>
    [
      escapeCsv(entry.loggedAt),
      escapeCsv(entry.nick),
      escapeCsv(entry.sessionId),
      (toNonNegativeInt(entry.elapsedMs) / 1000).toFixed(1),
      Number(entry.decision) === 1 ? 1 : 0,
    ].join(",")
  );

  const csvBody = `${header}${rows.join("\n")}\n`;
  const blob = new Blob([csvBody], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `goldminer-local-decisions-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return true;
}

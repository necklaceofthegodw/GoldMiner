const DECISION_LOG_ENDPOINT = "/api/decision-log";
const MAX_PENDING_ENTRIES = 10000;
const MAX_BATCH_SIZE = 1000;
const FLUSH_DEBOUNCE_MS = 1200;
const IMMEDIATE_FLUSH_THRESHOLD = 2000;

let pendingEntries = [];
let isFlushing = false;
let retryTimer = 0;
let scheduledFlushTimer = 0;
let activeNick = "";
let activeSessionId = "";

function createSessionId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDecisionEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const elapsedMs = Math.max(0, Math.round(Number(entry.elapsedMs) || 0));
  const decision = Number(entry.decision) === 1 ? 1 : 0;
  return {
    type: "decision",
    elapsedMs,
    decision,
    nick: activeNick,
    sessionId: activeSessionId,
  };
}

function normalizeNick(nick) {
  const value = String(nick ?? "").trim();
  if (!value) return null;
  return value;
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = globalThis.setTimeout(() => {
    retryTimer = 0;
    void flushDecisionLog();
  }, 1500);
}

function scheduleFlush(delayMs = FLUSH_DEBOUNCE_MS) {
  if (scheduledFlushTimer) return;
  scheduledFlushTimer = globalThis.setTimeout(() => {
    scheduledFlushTimer = 0;
    void flushDecisionLog();
  }, Math.max(0, Math.round(delayMs)));
}

async function flushDecisionLog() {
  if (isFlushing || pendingEntries.length === 0) return;
  isFlushing = true;

  if (scheduledFlushTimer) {
    globalThis.clearTimeout(scheduledFlushTimer);
    scheduledFlushTimer = 0;
  }

  const batch = pendingEntries.slice(0, MAX_BATCH_SIZE);
  try {
    const response = await fetch(DECISION_LOG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ entries: batch }),
    });

    if (!response.ok) {
      throw new Error(`Decision log request failed: ${response.status}`);
    }

    pendingEntries = pendingEntries.slice(batch.length);
  } catch {
    scheduleRetry();
  } finally {
    isFlushing = false;
    if (pendingEntries.length > 0 && !retryTimer) {
      void flushDecisionLog();
    }
  }
}

export function appendDecisionEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;

  for (const entry of entries) {
    const normalized = normalizeDecisionEntry(entry);
    if (!normalized) continue;
    pendingEntries.push(normalized);
  }

  if (pendingEntries.length > MAX_PENDING_ENTRIES) {
    pendingEntries = pendingEntries.slice(-MAX_PENDING_ENTRIES);
  }

  if (pendingEntries.length >= IMMEDIATE_FLUSH_THRESHOLD) {
    void flushDecisionLog();
    return;
  }

  scheduleFlush();
}

export function startDecisionSession(nick) {
  const normalizedNick = normalizeNick(nick);
  if (!normalizedNick) return;
  activeNick = normalizedNick;
  activeSessionId = createSessionId();

  pendingEntries.push({
    type: "nick",
    nick: normalizedNick,
    sessionId: activeSessionId,
  });

  if (pendingEntries.length > MAX_PENDING_ENTRIES) {
    pendingEntries = pendingEntries.slice(-MAX_PENDING_ENTRIES);
  }

  scheduleFlush();
}

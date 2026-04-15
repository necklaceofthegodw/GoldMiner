const DECISION_LOG_ENDPOINT = "/api/decision-log";
const MAX_PENDING_ENTRIES = 10000;

let pendingEntries = [];
let isFlushing = false;
let retryTimer = 0;

function normalizeDecisionEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const elapsedMs = Math.max(0, Math.round(Number(entry.elapsedMs) || 0));
  const decision = Number(entry.decision) === 1 ? 1 : 0;
  return { type: "decision", elapsedMs, decision };
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

async function flushDecisionLog() {
  if (isFlushing || pendingEntries.length === 0) return;
  isFlushing = true;

  const batch = pendingEntries.slice(0, 200);
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

  void flushDecisionLog();
}

export function startDecisionSession(nick) {
  const normalizedNick = normalizeNick(nick);
  if (!normalizedNick) return;

  pendingEntries.push({
    type: "nick",
    nick: normalizedNick,
  });

  if (pendingEntries.length > MAX_PENDING_ENTRIES) {
    pendingEntries = pendingEntries.slice(-MAX_PENDING_ENTRIES);
  }

  void flushDecisionLog();
}

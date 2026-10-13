import { ChoiceHttpClient } from "./choiceHttpClient.js";
import { readChoiceHttpConfig } from "./choiceHttpConfig.js";

const LOCAL_DECISION_LOG_STORAGE_KEY = "goldminer:decision-detail:v1";
const MAX_LOCAL_DECISION_ROWS = 12000;
const httpClient = new ChoiceHttpClient(readChoiceHttpConfig());
let localDecisionRows = loadLocalDecisionRows();
let activeNick = "";
let activeSessionId = "";

function normalizeNick(nick) {
  return String(nick ?? "").trim().replace(/[\r\n]+/g, " ").slice(0, 64);
}

function loadLocalDecisionRows() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(LOCAL_DECISION_LOG_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) =>
      entry?.nick && entry.sessionId && Number.isFinite(entry.elapsedMs) &&
      (entry.decision === 0 || entry.decision === 1) && Number.isFinite(Date.parse(entry.loggedAt))
    ).slice(-MAX_LOCAL_DECISION_ROWS) : [];
  } catch { return []; }
}

export function appendDecisionEntries(entries) {
  if (!Array.isArray(entries) || !activeNick || !activeSessionId) return;
  let changed = false;
  for (const entry of entries) {
    if ((entry?.decision !== 0 && entry?.decision !== 1) ||
      !Number.isFinite(entry.elapsedMs) || entry.elapsedMs < 0) continue;
    const loggedAt = entry.timestampGeneration ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(loggedAt))) continue;
    localDecisionRows.push({
      nick: activeNick, sessionId: activeSessionId,
      elapsedMs: entry.elapsedMs, decision: entry.decision, loggedAt,
    });
    changed = true;
    httpClient.enqueue({ ...entry, timestampGeneration: loggedAt });
  }
  if (!changed) return;
  localDecisionRows = localDecisionRows.slice(-MAX_LOCAL_DECISION_ROWS);
  try {
    globalThis.localStorage?.setItem(LOCAL_DECISION_LOG_STORAGE_KEY, JSON.stringify(localDecisionRows));
  } catch {
    // HTTP outbox persistence is handled separately, before sending each decision.
  }
}

export function startDecisionSession(nick) {
  const normalizedNick = normalizeNick(nick);
  if (!normalizedNick) return;
  activeNick = normalizedNick;
  activeSessionId = httpClient.startSession();
}

export function getLocalDecisionExportCount() {
  return localDecisionRows.length;
}

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function exportLocalDecisionCsv() {
  if (localDecisionRows.length === 0) return false;
  const header = "timestamp_iso,nick,session_id,czas_zdarzenia_s,decyzja\n";
  const rows = localDecisionRows.map((entry) => [
    escapeCsv(entry.loggedAt), escapeCsv(entry.nick), escapeCsv(entry.sessionId),
    (entry.elapsedMs / 1000).toFixed(1), entry.decision,
  ].join(","));
  const blob = new Blob([header + rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "goldminer-local-decisions-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".csv";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return true;
}

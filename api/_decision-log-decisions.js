import { normalizeNick, toNickSlug } from "./_decision-log.js";

export const DECISION_CSV_PREFIX = "decision-logs/decisions-v1/";
export const DECISION_CSV_HEADER = "timestamp,decyzja\n";

const MAX_CHUNK_ROWS = 3000;
const MAX_PROCESSED_CHUNK_IDS = 4000;

function toNonNegativeInt(value, fallback = 0) {
  return Math.max(0, Math.round(Number(value) || fallback));
}

function normalizeSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId) return "";
  return sessionId.slice(0, 120);
}

function normalizeChunkId(value) {
  const chunkId = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!chunkId) return "";
  return chunkId.slice(0, 180);
}

function normalizeChunkRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(0, MAX_CHUNK_ROWS)
    .map((row) => ({
      elapsedMs: toNonNegativeInt(row?.elapsedMs),
      decision: Number(row?.decision) === 1 ? 1 : 0,
    }));
}

function normalizeChunkIdList(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(normalizeChunkId).filter(Boolean))].slice(-MAX_PROCESSED_CHUNK_IDS);
}

function ensureCsvHeader(text) {
  const raw = String(text ?? "");
  const hasBody = raw.trim().length > 0;
  if (!hasBody) return DECISION_CSV_HEADER;

  const normalized = raw.endsWith("\n") ? raw : `${raw}\n`;
  if (normalized.startsWith(DECISION_CSV_HEADER)) return normalized;
  return `${DECISION_CSV_HEADER}${normalized}`;
}

export function normalizeDecisionCsvNick(value) {
  return normalizeNick(value);
}

export function buildDecisionCsvBasePath(nick) {
  return `${DECISION_CSV_PREFIX}${toNickSlug(nick)}/`;
}

export function buildDecisionCsvPath(nick) {
  return `${buildDecisionCsvBasePath(nick)}decisions.csv`;
}

export function buildDecisionStatePath(nick) {
  return `${buildDecisionCsvBasePath(nick)}state.json`;
}

export function normalizeDecisionChunkPayload(input) {
  if (!input || typeof input !== "object") return null;
  const nick = normalizeNick(input.nick);
  const sessionId = normalizeSessionId(input.sessionId);
  const chunkId = normalizeChunkId(input.chunkId);
  const rows = normalizeChunkRows(input.rows);
  if (!nick || !sessionId || !chunkId || rows.length === 0) return null;
  return { nick, sessionId, chunkId, rows };
}

export function parseDecisionState(rawState, nick) {
  const fallback = {
    version: 1,
    nick: normalizeNick(nick),
    processedChunkIds: [],
  };

  if (!rawState) return fallback;
  try {
    const parsed = JSON.parse(String(rawState));
    return {
      version: 1,
      nick: normalizeNick(parsed?.nick || nick),
      processedChunkIds: normalizeChunkIdList(parsed?.processedChunkIds),
    };
  } catch {
    return fallback;
  }
}

export function hasProcessedChunk(state, chunkId) {
  const normalizedChunkId = normalizeChunkId(chunkId);
  if (!normalizedChunkId) return false;
  return Boolean(state?.processedChunkIds?.includes(normalizedChunkId));
}

export function withProcessedChunk(state, chunkId) {
  const normalizedChunkId = normalizeChunkId(chunkId);
  const normalizedNick = normalizeNick(state?.nick);
  const current = normalizeChunkIdList(state?.processedChunkIds);
  if (!normalizedChunkId) {
    return {
      version: 1,
      nick: normalizedNick,
      processedChunkIds: current,
    };
  }

  const next = normalizeChunkIdList([...current, normalizedChunkId]);
  return {
    version: 1,
    nick: normalizedNick,
    processedChunkIds: next,
  };
}

export function appendDecisionRowsToCsv(existingCsv, rows) {
  const normalizedRows = normalizeChunkRows(rows);
  const base = ensureCsvHeader(existingCsv);
  if (normalizedRows.length === 0) return base;

  const lines = normalizedRows.map((entry) => `${(entry.elapsedMs / 1000).toFixed(1)},${entry.decision}`);
  return `${base}${lines.join("\n")}\n`;
}

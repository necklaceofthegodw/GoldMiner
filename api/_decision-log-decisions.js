import { normalizeNick, toNickSlug } from "./_decision-log.js";

export const DECISION_CSV_PREFIX = "decision-logs/decisions-v1/";
export const DECISION_CSV_HEADER = "timestamp,decyzja\n";
const DECISION_CHUNK_DIRECTORY = "chunks";

const MAX_CHUNK_ROWS = 3000;

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

function toPathToken(value, fallback = "na") {
  const token = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || fallback;
}

function parseChunkRange(chunkId) {
  const text = normalizeChunkId(chunkId);
  const match = text.match(/^(?<session>.+):(?<start>\d+)-(?<end>\d+)$/);
  if (!match?.groups) return null;

  const start = Number.parseInt(match.groups.start, 10);
  const end = Number.parseInt(match.groups.end, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return {
    sessionId: normalizeSessionId(match.groups.session),
    start,
    end,
  };
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

export function buildDecisionChunksPrefix(nick) {
  return `${buildDecisionCsvBasePath(nick)}${DECISION_CHUNK_DIRECTORY}/`;
}

export function buildDecisionChunkPath(nick, sessionId, chunkId) {
  const safeNick = normalizeDecisionCsvNick(nick);
  const safeSession = normalizeSessionId(sessionId);
  const safeChunkId = normalizeChunkId(chunkId);
  if (!safeNick || !safeSession || !safeChunkId) return "";

  const range = parseChunkRange(safeChunkId);
  const safeSessionToken = toPathToken(safeSession, "session");
  if (!range) {
    return `${buildDecisionChunksPrefix(safeNick)}${safeSessionToken}/${toPathToken(safeChunkId, "chunk")}.csv`;
  }

  const startToken = String(range.start).padStart(9, "0");
  const endToken = String(range.end).padStart(9, "0");
  return `${buildDecisionChunksPrefix(safeNick)}${safeSessionToken}/${startToken}-${endToken}.csv`;
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

export function appendDecisionRowsToCsv(existingCsv, rows) {
  const normalizedRows = normalizeChunkRows(rows);
  const base = ensureCsvHeader(existingCsv);
  if (normalizedRows.length === 0) return base;

  const lines = normalizedRows.map((entry) => `${(entry.elapsedMs / 1000).toFixed(1)},${entry.decision}`);
  return `${base}${lines.join("\n")}\n`;
}

export function toDecisionChunkCsvBody(rows) {
  const normalizedRows = normalizeChunkRows(rows);
  if (normalizedRows.length === 0) return "";
  return `${normalizedRows.map((entry) => `${(entry.elapsedMs / 1000).toFixed(1)},${entry.decision}`).join("\n")}\n`;
}

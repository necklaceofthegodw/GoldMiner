import { get, list, put } from "@vercel/blob";
import { TextDecoder } from "node:util";
import { LOG_CHUNK_PREFIX, normalizeIncomingEntries, normalizeNick, parseLegacyCsvChunk } from "./_decision-log.js";

export const USERS_INDEX_PATH = "decision-logs/index/users-v1.json";
const USERS_INDEX_VERSION = 1;
const DEFAULT_READ_CONCURRENCY = 12;

async function readStreamAsText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function createEmptyUsersIndex() {
  return {
    version: USERS_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    users: {},
  };
}

function normalizeUsersIndex(input) {
  const base = createEmptyUsersIndex();
  if (!input || typeof input !== "object") return base;

  const rawUsers = input.users && typeof input.users === "object" ? input.users : {};
  const users = {};

  for (const [rawNick, rawUser] of Object.entries(rawUsers)) {
    const nick = normalizeNick(rawNick);
    if (!nick) continue;

    const sessions = Array.isArray(rawUser?.sessions)
      ? [...new Set(rawUser.sessions.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];
    const chunkPathnames = Array.isArray(rawUser?.chunkPathnames)
      ? [...new Set(rawUser.chunkPathnames.map((value) => String(value || "").trim()).filter(Boolean))]
      : [];

    users[nick] = {
      nick,
      totalDecisions: Math.max(0, Math.round(Number(rawUser?.totalDecisions) || 0)),
      ones: Math.max(0, Math.round(Number(rawUser?.ones) || 0)),
      zeros: Math.max(0, Math.round(Number(rawUser?.zeros) || 0)),
      lastSeen: rawUser?.lastSeen ? String(rawUser.lastSeen) : null,
      sessions,
      chunkPathnames,
    };
  }

  return {
    version: USERS_INDEX_VERSION,
    updatedAt: input?.updatedAt ? String(input.updatedAt) : base.updatedAt,
    users,
  };
}

function createMutableUserRecord(nick) {
  return {
    nick,
    totalDecisions: 0,
    ones: 0,
    zeros: 0,
    lastSeen: null,
    sessions: new Set(),
    chunkPathnames: new Set(),
  };
}

function toMutableUsersMap(index) {
  const mutableMap = new Map();
  for (const [nick, user] of Object.entries(index.users)) {
    const record = createMutableUserRecord(nick);
    record.totalDecisions = user.totalDecisions;
    record.ones = user.ones;
    record.zeros = user.zeros;
    record.lastSeen = user.lastSeen || null;
    for (const sessionId of user.sessions) record.sessions.add(sessionId);
    for (const pathname of user.chunkPathnames) record.chunkPathnames.add(pathname);
    mutableMap.set(nick, record);
  }
  return mutableMap;
}

function fromMutableUsersMap(usersMap) {
  const users = {};
  for (const [nick, user] of usersMap.entries()) {
    users[nick] = {
      nick,
      totalDecisions: user.totalDecisions,
      ones: user.ones,
      zeros: user.zeros,
      lastSeen: user.lastSeen,
      sessions: [...user.sessions],
      chunkPathnames: [...user.chunkPathnames].sort(),
    };
  }

  return {
    version: USERS_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    users,
  };
}

function applyEntriesToUsersMap(usersMap, entries, pathname = "") {
  const chunkNickSet = new Set();

  for (const entry of entries) {
    const nick = normalizeNick(entry?.nick);
    if (!nick) continue;

    const existing = usersMap.get(nick) ?? createMutableUserRecord(nick);
    const sessionId = String(entry?.sessionId || "").trim();
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
    if (pathname) chunkNickSet.add(nick);
  }

  if (pathname) {
    for (const nick of chunkNickSet) {
      const existing = usersMap.get(nick) ?? createMutableUserRecord(nick);
      existing.chunkPathnames.add(pathname);
      usersMap.set(nick, existing);
    }
  }
}

export async function listAllChunks() {
  const blobs = [];
  let cursor;
  while (true) {
    const page = await list({
      prefix: LOG_CHUNK_PREFIX,
      cursor,
      limit: 1000,
    });
    blobs.push(...page.blobs);
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
  return blobs;
}

export async function readChunkEntries(pathname, { useCache = true } = {}) {
  const result = await get(pathname, {
    access: "private",
    useCache,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return [];

  const text = await readStreamAsText(result.stream);
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed?.entries)) {
      return normalizeIncomingEntries(parsed.entries);
    }
  } catch {
    return parseLegacyCsvChunk(trimmed);
  }

  return [];
}

export async function readEntriesFromChunkPathnames(pathnames, options = {}) {
  const uniquePathnames = [...new Set((Array.isArray(pathnames) ? pathnames : []).filter(Boolean))];
  if (uniquePathnames.length === 0) return [];

  const concurrency = toPositiveInt(options.concurrency, DEFAULT_READ_CONCURRENCY);
  const useCache = options.useCache !== false;
  const entries = [];
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= uniquePathnames.length) break;
      const pathname = uniquePathnames[index];
      const chunkEntries = await readChunkEntries(pathname, { useCache });
      entries.push(...chunkEntries);
    }
  };

  const workers = [];
  const workerCount = Math.min(concurrency, uniquePathnames.length);
  for (let index = 0; index < workerCount; index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return entries;
}

export async function readAllEntries() {
  const blobs = await listAllChunks();
  return readEntriesFromChunkPathnames(
    blobs.map((blob) => blob.pathname),
    {
      useCache: true,
      concurrency: DEFAULT_READ_CONCURRENCY,
    }
  );
}

export async function listAllChunkPathnames() {
  const blobs = await listAllChunks();
  return blobs.map((blob) => blob.pathname);
}

export async function readUsersIndex({ useCache = true } = {}) {
  const result = await get(USERS_INDEX_PATH, {
    access: "private",
    useCache,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  const text = (await readStreamAsText(result.stream)).trim();
  if (!text) return createEmptyUsersIndex();

  try {
    return normalizeUsersIndex(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeUsersIndex(index) {
  const normalizedIndex = normalizeUsersIndex(index);
  await put(USERS_INDEX_PATH, JSON.stringify(normalizedIndex), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
  });
  return normalizedIndex;
}

export async function rebuildUsersIndex() {
  const blobs = await listAllChunks();
  const usersMap = new Map();
  for (const blob of blobs) {
    const chunkEntries = await readChunkEntries(blob.pathname, { useCache: true });
    applyEntriesToUsersMap(usersMap, chunkEntries, blob.pathname);
  }

  const index = fromMutableUsersMap(usersMap);
  await writeUsersIndex(index);
  return index;
}

export async function upsertUsersIndexForChunk(pathname, entries) {
  const normalizedEntries = normalizeIncomingEntries(entries);
  if (!pathname || normalizedEntries.length === 0) return null;

  const existingIndex = (await readUsersIndex({ useCache: false })) ?? createEmptyUsersIndex();
  const usersMap = toMutableUsersMap(existingIndex);
  applyEntriesToUsersMap(usersMap, normalizedEntries, pathname);

  const nextIndex = fromMutableUsersMap(usersMap);
  await writeUsersIndex(nextIndex);
  return nextIndex;
}

export async function readUsersSummaryFromIndex() {
  const index = (await readUsersIndex({ useCache: true })) ?? (await rebuildUsersIndex());
  return Object.values(index.users).sort(
    (a, b) => b.totalDecisions - a.totalDecisions || a.nick.localeCompare(b.nick)
  );
}

export async function readEntriesForNick(nick) {
  const targetNick = normalizeNick(nick);
  if (!targetNick) return [];

  const cachedIndex = await readUsersIndex({ useCache: true });
  const index = cachedIndex ?? (await rebuildUsersIndex());
  const user = index.users[targetNick];
  if (!user || user.chunkPathnames.length === 0) return [];

  const allEntries = await readEntriesFromChunkPathnames(user.chunkPathnames, {
    useCache: true,
    concurrency: DEFAULT_READ_CONCURRENCY,
  });

  return allEntries.filter((entry) => normalizeNick(entry?.nick) === targetNick);
}

export async function findChunkPathnamesForNick(nick) {
  const targetNick = normalizeNick(nick);
  if (!targetNick) return [];

  const index = await readUsersIndex({ useCache: true });
  const indexPathnames = index?.users?.[targetNick]?.chunkPathnames;
  if (Array.isArray(indexPathnames)) {
    return [...new Set(indexPathnames.filter(Boolean))];
  }

  const blobs = await listAllChunks();
  const matching = [];
  for (const blob of blobs) {
    const chunkEntries = await readChunkEntries(blob.pathname, { useCache: true });
    const hasNick = chunkEntries.some((entry) => normalizeNick(entry?.nick) === targetNick);
    if (hasNick) matching.push(blob.pathname);
  }
  return matching;
}

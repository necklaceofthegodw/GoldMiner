import { get, list } from "@vercel/blob";
import { TextDecoder } from "node:util";
import { RUN_SUMMARY_PREFIX, normalizeNick, normalizeRunSummary, toNickSlug } from "./_decision-log.js";
import { DECISION_CSV_PREFIX, buildDecisionCsvBasePath, normalizeDecisionCsvNick } from "./_decision-log-decisions.js";

const DEFAULT_READ_CONCURRENCY = 8;

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

async function listBlobsByPrefix(prefix) {
  const blobs = [];
  let cursor;
  while (true) {
    const page = await list({
      prefix,
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

export async function listRunSummaryBlobs({ prefix = RUN_SUMMARY_PREFIX } = {}) {
  return listBlobsByPrefix(prefix);
}

export async function listAllRunSummaryPathnames() {
  const blobs = await listRunSummaryBlobs({ prefix: RUN_SUMMARY_PREFIX });
  return blobs.map((blob) => blob.pathname);
}

export async function listRunSummaryPathnamesForNick(nick) {
  const safeNick = normalizeNick(nick);
  if (!safeNick) return [];
  const blobs = await listRunSummaryBlobs({ prefix: `${RUN_SUMMARY_PREFIX}${toNickSlug(safeNick)}/` });
  return blobs.map((blob) => blob.pathname);
}

export async function listDecisionCsvBlobs({ prefix = DECISION_CSV_PREFIX } = {}) {
  return listBlobsByPrefix(prefix);
}

export async function listAllDecisionCsvPathnames() {
  const blobs = await listDecisionCsvBlobs({ prefix: DECISION_CSV_PREFIX });
  return blobs.map((blob) => blob.pathname);
}

export async function listDecisionCsvPathnamesForNick(nick) {
  const safeNick = normalizeDecisionCsvNick(nick);
  if (!safeNick) return [];
  const blobs = await listDecisionCsvBlobs({ prefix: buildDecisionCsvBasePath(safeNick) });
  return blobs.map((blob) => blob.pathname);
}

export async function readBlobText(pathname, { useCache = true } = {}) {
  const result = await get(pathname, {
    access: "private",
    useCache,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return "";
  return readStreamAsText(result.stream);
}

export async function readRunSummary(pathname, { useCache = true } = {}) {
  const text = (await readBlobText(pathname, { useCache })).trim();
  if (!text) return null;

  try {
    return normalizeRunSummary(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function readRunSummariesFromPathnames(pathnames, options = {}) {
  const uniquePathnames = [...new Set((Array.isArray(pathnames) ? pathnames : []).filter(Boolean))];
  if (uniquePathnames.length === 0) return [];

  const concurrency = toPositiveInt(options.concurrency, DEFAULT_READ_CONCURRENCY);
  const useCache = options.useCache !== false;
  const summaries = [];
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= uniquePathnames.length) break;
      const summary = await readRunSummary(uniquePathnames[index], { useCache });
      if (summary) summaries.push(summary);
    }
  };

  const workers = [];
  const workerCount = Math.min(concurrency, uniquePathnames.length);
  for (let index = 0; index < workerCount; index += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  summaries.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  return summaries;
}

export async function readAllRunSummaries({ useCache = true } = {}) {
  const pathnames = await listAllRunSummaryPathnames();
  return readRunSummariesFromPathnames(pathnames, {
    useCache,
    concurrency: DEFAULT_READ_CONCURRENCY,
  });
}

export async function readRunSummariesForNick(nick, { useCache = true } = {}) {
  const pathnames = await listRunSummaryPathnamesForNick(nick);
  return readRunSummariesFromPathnames(pathnames, {
    useCache,
    concurrency: DEFAULT_READ_CONCURRENCY,
  });
}

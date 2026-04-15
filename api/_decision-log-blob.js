import { get, list } from "@vercel/blob";
import { TextDecoder } from "node:util";
import { LOG_CHUNK_PREFIX, normalizeIncomingEntries, parseLegacyCsvChunk } from "./_decision-log.js";

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

export async function readChunkEntries(pathname) {
  const result = await get(pathname, {
    access: "private",
    useCache: false,
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

export async function readAllEntries() {
  const blobs = await listAllChunks();
  const entries = [];
  for (const blob of blobs) {
    const chunkEntries = await readChunkEntries(blob.pathname);
    entries.push(...chunkEntries);
  }
  return entries;
}

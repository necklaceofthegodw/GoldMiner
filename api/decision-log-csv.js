import { get, list } from "@vercel/blob";
import { TextDecoder } from "node:util";
import { CSV_HEADER, LOG_CHUNK_PREFIX } from "./_decision-log.js";

async function listAllChunks() {
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

async function readChunkText(pathname) {
  const blob = await get(pathname, { access: "private" });
  if (!blob?.stream) return "";
  const reader = blob.stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text.trimEnd();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  try {
    const blobs = await listAllChunks();
    const parts = [];
    for (const blob of blobs) {
      const chunk = await readChunkText(blob.pathname);
      if (chunk) parts.push(chunk);
    }

    const csvBody = `${CSV_HEADER}${parts.join("\n")}${parts.length ? "\n" : ""}`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", 'inline; filename="decisions.csv"');
    res.end(csvBody);
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Failed to read decision log." }));
  }
}

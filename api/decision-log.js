import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { LOG_CHUNK_PREFIX, normalizeIncomingEntries, parseEntriesFromRequest } from "./_decision-log.js";
import { upsertUsersIndexForChunk } from "./_decision-log-blob.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }

  try {
    const entries = await parseEntriesFromRequest(req);
    if (entries.length === 0) {
      res.statusCode = 204;
      res.end();
      return;
    }

    const normalizedEntries = normalizeIncomingEntries(entries);
    if (normalizedEntries.length === 0) {
      res.statusCode = 204;
      res.end();
      return;
    }

    const pathname = `${LOG_CHUNK_PREFIX}${Date.now()}-${randomUUID()}.json`;
    const body = JSON.stringify({
      version: 2,
      createdAt: new Date().toISOString(),
      entries: normalizedEntries,
    });
    await put(pathname, body, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
    });
    await upsertUsersIndexForChunk(pathname, normalizedEntries);

    res.statusCode = 204;
    res.end();
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Invalid decision log payload." }));
  }
}

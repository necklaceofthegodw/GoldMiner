import { put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { LOG_CHUNK_PREFIX, parseEntriesFromRequest, toCsvRows } from "./_decision-log.js";

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

    const rows = toCsvRows(entries);
    if (rows.length === 0) {
      res.statusCode = 204;
      res.end();
      return;
    }

    const pathname = `${LOG_CHUNK_PREFIX}${Date.now()}-${randomUUID()}.csv`;
    await put(pathname, `${rows.join("\n")}\n`, {
      access: "private",
      addRandomSuffix: false,
      contentType: "text/csv; charset=utf-8",
    });

    res.statusCode = 204;
    res.end();
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Invalid decision log payload." }));
  }
}

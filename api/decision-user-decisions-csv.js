import {
  DECISION_CSV_HEADER,
  buildDecisionChunksPrefix,
  buildDecisionCsvPath,
  normalizeDecisionCsvNick,
} from "./_decision-log-decisions.js";
import { requireDecisionLogAdminAuth } from "./_decision-log-admin-auth.js";
import { listDecisionCsvBlobs, readBlobText } from "./_decision-log-blob.js";

function toCsvRows(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "timestamp,decyzja");
}

function buildCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return DECISION_CSV_HEADER;
  return `${DECISION_CSV_HEADER}${rows.join("\n")}\n`;
}

export default async function handler(req, res) {
  if (!requireDecisionLogAdminAuth(req, res)) return;

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  try {
    const nick = normalizeDecisionCsvNick(req.query?.nick);
    if (!nick) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Query parameter 'nick' is required." }));
      return;
    }

    const csvPath = buildDecisionCsvPath(nick);
    const legacyCsv = await readBlobText(csvPath, { useCache: true });
    const chunkPrefix = buildDecisionChunksPrefix(nick);
    const chunkBlobs = await listDecisionCsvBlobs({ prefix: chunkPrefix });
    const chunkTexts = await Promise.all(
      chunkBlobs
        .map((blob) => blob?.pathname)
        .filter(Boolean)
        .map((pathname) => readBlobText(pathname, { useCache: true }))
    );

    const rows = [...toCsvRows(legacyCsv)];
    for (const text of chunkTexts) {
      rows.push(...toCsvRows(text));
    }
    const csvBody = buildCsv(rows);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Disposition", `inline; filename="decisions-${encodeURIComponent(nick)}.csv"`);
    res.end(csvBody);
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Failed to read user decisions CSV." }));
  }
}

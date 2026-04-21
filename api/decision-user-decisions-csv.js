import { DECISION_CSV_HEADER, buildDecisionCsvPath, normalizeDecisionCsvNick } from "./_decision-log-decisions.js";
import { requireDecisionLogAdminAuth } from "./_decision-log-admin-auth.js";
import { readBlobText } from "./_decision-log-blob.js";

function ensureCsv(text) {
  const raw = String(text ?? "");
  if (!raw.trim()) return DECISION_CSV_HEADER;
  if (raw.startsWith(DECISION_CSV_HEADER)) {
    return raw.endsWith("\n") ? raw : `${raw}\n`;
  }
  const normalized = raw.endsWith("\n") ? raw : `${raw}\n`;
  return `${DECISION_CSV_HEADER}${normalized}`;
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
    const rawCsv = await readBlobText(csvPath, { useCache: true });
    const csvBody = ensureCsv(rawCsv);

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

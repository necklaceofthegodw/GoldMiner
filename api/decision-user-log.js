import { requireDecisionLogAdminAuth } from "./_decision-log-admin-auth.js";
import { USER_RUN_CSV_HEADER, normalizeNick, toUserRunCsvRows } from "./_decision-log.js";
import { readRunSummariesForNick } from "./_decision-log-blob.js";

export default async function handler(req, res) {
  if (!requireDecisionLogAdminAuth(req, res)) return;

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  try {
    const nick = normalizeNick(req.query?.nick);
    if (!nick) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Query parameter 'nick' is required." }));
      return;
    }

    const summaries = await readRunSummariesForNick(nick, { useCache: true });
    const csvRows = toUserRunCsvRows(summaries);
    const csvBody = `${USER_RUN_CSV_HEADER}${csvRows.length > 0 ? `${csvRows.join("\n")}\n` : ""}`;

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Disposition", `inline; filename="runs-${encodeURIComponent(nick)}.csv"`);
    res.end(csvBody);
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Failed to read user run summaries." }));
  }
}

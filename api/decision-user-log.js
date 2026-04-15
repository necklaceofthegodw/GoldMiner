import { USER_LOG_CSV_HEADER, buildUserDecisionRows } from "./_decision-log.js";
import { readAllEntries } from "./_decision-log-blob.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  try {
    const nick = typeof req.query?.nick === "string" ? req.query.nick : "";
    if (!nick.trim()) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Query parameter 'nick' is required." }));
      return;
    }

    const entries = await readAllEntries();
    const rows = buildUserDecisionRows(entries, nick);
    const csvRows = rows.map((row) => `${row.seconds},${row.decision},${row.sessionId}`);
    const csvBody = `${USER_LOG_CSV_HEADER}${csvRows.length > 0 ? `${csvRows.join("\n")}\n` : ""}`;

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `inline; filename="decisions-${encodeURIComponent(nick)}.csv"`);
    res.end(csvBody);
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Failed to read user log." }));
  }
}

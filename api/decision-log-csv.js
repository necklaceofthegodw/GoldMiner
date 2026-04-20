import { requireDecisionLogAdminAuth } from "./_decision-log-admin-auth.js";
import { RUN_SUMMARY_CSV_HEADER, toRunSummaryCsvRows } from "./_decision-log.js";
import { readAllRunSummaries } from "./_decision-log-blob.js";

export default async function handler(req, res) {
  if (!requireDecisionLogAdminAuth(req, res)) return;

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  try {
    const summaries = await readAllRunSummaries({ useCache: true });
    const rows = toRunSummaryCsvRows(summaries);
    const csvBody = `${RUN_SUMMARY_CSV_HEADER}${rows.length > 0 ? `${rows.join("\n")}\n` : ""}`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("Content-Disposition", 'inline; filename="run-summaries.csv"');
    res.end(csvBody);
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Failed to read run summaries." }));
  }
}

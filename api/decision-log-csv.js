import { CSV_HEADER, toCsvRows } from "./_decision-log.js";
import { readAllEntries } from "./_decision-log-blob.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  try {
    const entries = await readAllEntries();
    const rows = toCsvRows(entries);
    const csvBody = `${CSV_HEADER}${rows.length > 0 ? `${rows.join("\n")}\n` : ""}`;
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

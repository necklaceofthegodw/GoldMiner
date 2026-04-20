import { put } from "@vercel/blob";
import { buildRunSummaryPathname, parseRunSummaryFromRequest } from "./_decision-log.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }

  try {
    const runSummary = await parseRunSummaryFromRequest(req);
    if (!runSummary) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Invalid run summary payload." }));
      return;
    }

    const pathname = buildRunSummaryPathname(runSummary);
    const body = JSON.stringify(runSummary);
    await put(pathname, body, {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json; charset=utf-8",
    });

    res.statusCode = 204;
    res.end();
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Invalid run summary payload." }));
  }
}

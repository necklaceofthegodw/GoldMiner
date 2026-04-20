import { requireDecisionLogAdminAuth } from "./_decision-log-admin-auth.js";
import { summarizeUsersFromRuns } from "./_decision-log.js";
import { readAllRunSummaries } from "./_decision-log-blob.js";

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
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
    const summaries = await readAllRunSummaries({ useCache: true });
    const users = summarizeUsersFromRuns(summaries);
    const page = parsePositiveInt(req.query?.page, 1);
    const limit = Math.min(500, parsePositiveInt(req.query?.limit, 200));
    const total = users.length;
    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const pagedUsers = users.slice(start, start + limit);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=60");
    res.end(
      JSON.stringify({
        users: pagedUsers.map((user) => ({
          nick: user.nick,
          sessions: Number(user.sessions) || 0,
          runs: user.runs,
          wins: user.wins,
          fails: user.fails,
          totalDecisions: user.totalDecisions,
          ones: user.ones,
          zeros: user.zeros,
          lastSeen: user.lastSeen || null,
        })),
        paging: {
          page: safePage,
          limit,
          total,
          totalPages,
        },
      })
    );
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Failed to read users summary." }));
  }
}

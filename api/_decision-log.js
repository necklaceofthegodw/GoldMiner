export const RUN_SUMMARY_VERSION = 3;
export const RUN_SUMMARY_PREFIX = "decision-logs/runs-v3/";
export const RUN_SUMMARY_CSV_HEADER =
  "nick,session_id,started_at,finished_at,result,last_level,completed_levels,total_decisions,ones,zeros,total_earned,bank\n";
export const USER_RUN_CSV_HEADER =
  "session_id,started_at,finished_at,result,last_level,completed_levels,total_decisions,ones,zeros,total_earned,bank\n";

function escapeCsv(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function normalizeNick(value) {
  const nick = String(value ?? "").trim().replace(/[\r\n]+/g, " ");
  if (!nick) return "";
  return nick.slice(0, 64);
}

function normalizeSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId) return "";
  return sessionId.slice(0, 120);
}

function normalizeIsoDate(value, fallback = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return fallback;
  return date.toISOString();
}

function toNonNegativeInt(value, fallback = 0) {
  return Math.max(0, Math.round(Number(value) || fallback));
}

function normalizeRunHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry) => ({
      level: toNonNegativeInt(entry?.level),
      goal: toNonNegativeInt(entry?.goal),
      earned: toNonNegativeInt(entry?.earned),
      reward: toNonNegativeInt(entry?.reward),
      oneDecisions: toNonNegativeInt(entry?.oneDecisions),
      zeroDecisions: toNonNegativeInt(entry?.zeroDecisions),
      success: Boolean(entry?.success),
    }))
    .filter((entry) => entry.level > 0)
    .sort((a, b) => a.level - b.level)
    .slice(0, 32);
}

export function normalizeRunSummary(input) {
  if (!input || typeof input !== "object") return null;

  const nick = normalizeNick(input.nick);
  const sessionId = normalizeSessionId(input.sessionId);
  const finishedAt = normalizeIsoDate(input.finishedAt);
  const startedAt = normalizeIsoDate(input.startedAt, finishedAt);
  if (!nick || !sessionId || !finishedAt) return null;

  const ones = toNonNegativeInt(input.ones);
  const zeros = toNonNegativeInt(input.zeros);
  const totalDecisions = Math.max(toNonNegativeInt(input.totalDecisions), ones + zeros);
  const endedPhase = String(input.endedPhase || "").trim() === "run-complete" ? "run-complete" : "level-failed";
  const success = input.success === undefined ? endedPhase === "run-complete" : Boolean(input.success);
  const completedLevels = toNonNegativeInt(input.completedLevels);
  const lastLevel = Math.max(1, toNonNegativeInt(input.lastLevel, 1));

  return {
    version: RUN_SUMMARY_VERSION,
    kind: "run-summary",
    nick,
    sessionId,
    startedAt,
    finishedAt,
    endedPhase,
    success,
    completedLevels,
    lastLevel,
    totalDecisions,
    ones,
    zeros,
    totalEarned: toNonNegativeInt(input.totalEarned),
    bank: toNonNegativeInt(input.bank),
    history: normalizeRunHistory(input.history),
  };
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("payload-too-large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function parseRunSummaryFromRequest(req) {
  const rawBody = await readRawBody(req);
  const payload = rawBody ? JSON.parse(rawBody) : {};
  const rawSummary =
    payload?.runSummary && typeof payload.runSummary === "object" ? payload.runSummary : payload;
  return normalizeRunSummary(rawSummary);
}

export function toNickSlug(nick) {
  const normalized = normalizeNick(nick)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "anon";
}

function toPathToken(value, fallback = "na") {
  const token = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || fallback;
}

export function buildRunSummaryPathname(summary) {
  const nickSlug = toNickSlug(summary?.nick);
  const sessionToken = toPathToken(summary?.sessionId, "session");
  const finishedToken = String(summary?.finishedAt || "")
    .replace(/[^0-9]+/g, "")
    .slice(0, 17);
  return `${RUN_SUMMARY_PREFIX}${nickSlug}/${sessionToken}-${finishedToken || "ts"}.json`;
}

export function toRunSummaryCsvRows(summaries) {
  if (!Array.isArray(summaries)) return [];
  return summaries.map((summary) =>
    [
      escapeCsv(summary.nick),
      escapeCsv(summary.sessionId),
      escapeCsv(summary.startedAt),
      escapeCsv(summary.finishedAt),
      escapeCsv(summary.success ? "win" : "fail"),
      summary.lastLevel,
      summary.completedLevels,
      summary.totalDecisions,
      summary.ones,
      summary.zeros,
      summary.totalEarned,
      summary.bank,
    ].join(",")
  );
}

export function toUserRunCsvRows(summaries) {
  if (!Array.isArray(summaries)) return [];
  return summaries.map((summary) =>
    [
      escapeCsv(summary.sessionId),
      escapeCsv(summary.startedAt),
      escapeCsv(summary.finishedAt),
      escapeCsv(summary.success ? "win" : "fail"),
      summary.lastLevel,
      summary.completedLevels,
      summary.totalDecisions,
      summary.ones,
      summary.zeros,
      summary.totalEarned,
      summary.bank,
    ].join(",")
  );
}

export function summarizeUsersFromRuns(summaries) {
  const usersMap = new Map();
  if (!Array.isArray(summaries)) return [];

  for (const summary of summaries) {
    const nick = normalizeNick(summary?.nick);
    if (!nick) continue;

    const user =
      usersMap.get(nick) ??
      {
        nick,
        runs: 0,
        wins: 0,
        fails: 0,
        totalDecisions: 0,
        ones: 0,
        zeros: 0,
        lastSeen: "",
        sessions: new Set(),
      };

    user.runs += 1;
    if (summary?.success) user.wins += 1;
    if (!summary?.success) user.fails += 1;
    user.totalDecisions += toNonNegativeInt(summary?.totalDecisions);
    user.ones += toNonNegativeInt(summary?.ones);
    user.zeros += toNonNegativeInt(summary?.zeros);
    const finishedAt = normalizeIsoDate(summary?.finishedAt);
    if (finishedAt && (!user.lastSeen || finishedAt > user.lastSeen)) {
      user.lastSeen = finishedAt;
    }
    const sessionId = normalizeSessionId(summary?.sessionId);
    if (sessionId) user.sessions.add(sessionId);

    usersMap.set(nick, user);
  }

  return [...usersMap.values()]
    .map((user) => ({
      nick: user.nick,
      runs: user.runs,
      wins: user.wins,
      fails: user.fails,
      totalDecisions: user.totalDecisions,
      ones: user.ones,
      zeros: user.zeros,
      sessions: user.sessions.size,
      lastSeen: user.lastSeen || null,
    }))
    .sort((a, b) => b.totalDecisions - a.totalDecisions || a.nick.localeCompare(b.nick));
}

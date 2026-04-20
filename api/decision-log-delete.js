import { del } from "@vercel/blob";
import {
  readAdminKeyFromRequest,
  requireDecisionLogAdminAuth,
  withAdminKey,
} from "./_decision-log-admin-auth.js";
import { listAllRunSummaryPathnames, listRunSummaryPathnamesForNick } from "./_decision-log-blob.js";
import { normalizeNick } from "./_decision-log.js";

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error("payload-too-large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function parseDeleteRequest(req) {
  const actionFromQuery = typeof req.query?.action === "string" ? req.query.action : "";
  const nickFromQuery = typeof req.query?.nick === "string" ? req.query.nick : "";

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return {
      action: typeof req.body.action === "string" ? req.body.action : actionFromQuery,
      nick: typeof req.body.nick === "string" ? req.body.nick : nickFromQuery,
    };
  }

  const rawBody = await readRawBody(req);
  if (!rawBody) {
    return { action: actionFromQuery, nick: nickFromQuery };
  }

  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    return {
      action: params.get("action") || actionFromQuery,
      nick: params.get("nick") || nickFromQuery,
    };
  }

  try {
    const payload = JSON.parse(rawBody);
    return {
      action: typeof payload?.action === "string" ? payload.action : actionFromQuery,
      nick: typeof payload?.nick === "string" ? payload.nick : nickFromQuery,
    };
  } catch {
    return { action: actionFromQuery, nick: nickFromQuery };
  }
}

function redirectToView(res, adminKey, params = "") {
  const targetPath = `/api/decision-log-view${params ? `?${params}` : ""}`;
  res.statusCode = 303;
  res.setHeader("Location", withAdminKey(targetPath, adminKey));
  res.end();
}

export default async function handler(req, res) {
  if (!requireDecisionLogAdminAuth(req, res)) return;

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }

  try {
    const adminKey = readAdminKeyFromRequest(req);
    const { action, nick } = await parseDeleteRequest(req);
    if (action === "all") {
      const pathnames = await listAllRunSummaryPathnames();
      if (pathnames.length > 0) await del(pathnames);
      redirectToView(res, adminKey, `msg=deleted_all&count=${pathnames.length}`);
      return;
    }

    if (action === "user") {
      const safeNick = normalizeNick(nick);
      if (!safeNick) {
        redirectToView(res, adminKey, "msg=nick_required");
        return;
      }

      const pathnames = await listRunSummaryPathnamesForNick(safeNick);
      if (pathnames.length > 0) await del(pathnames);
      redirectToView(
        res,
        adminKey,
        `msg=deleted_user&nick=${encodeURIComponent(safeNick)}&count=${pathnames.length}`
      );
      return;
    }

    redirectToView(res, adminKey, "msg=invalid_action");
  } catch {
    const adminKey = readAdminKeyFromRequest(req);
    redirectToView(res, adminKey, "msg=delete_failed");
  }
}

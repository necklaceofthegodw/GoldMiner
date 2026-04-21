import { put } from "@vercel/blob";
import {
  buildDecisionChunkPath,
  normalizeDecisionChunkPayload,
  toDecisionChunkCsvBody,
} from "./_decision-log-decisions.js";

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

async function parseRequestPayload(req) {
  const rawBody = await readRawBody(req);
  const parsed = rawBody ? JSON.parse(rawBody) : {};
  return normalizeDecisionChunkPayload(parsed);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }

  let payload;
  try {
    payload = await parseRequestPayload(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Invalid decision chunk payload." }));
    return;
  }

  if (!payload) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Invalid decision chunk payload." }));
    return;
  }

  try {
    const chunkPath = buildDecisionChunkPath(payload.nick, payload.sessionId, payload.chunkId);
    const body = toDecisionChunkCsvBody(payload.rows);
    if (!chunkPath || !body) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Invalid decision chunk payload." }));
      return;
    }

    await put(chunkPath, body, {
      access: "private",
      addRandomSuffix: false,
      contentType: "text/plain; charset=utf-8",
    });

    res.statusCode = 204;
    res.end();
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Failed to write decision chunk." }));
  }
}

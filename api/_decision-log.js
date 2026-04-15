export const CSV_HEADER = "czas_zdarzenia_s,decyzja\n";
export const LOG_CHUNK_PREFIX = "decision-logs/chunks/";

function escapeCsv(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") {
    return JSON.stringify(req.body);
  }

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

export async function parseEntriesFromRequest(req) {
  const rawBody = await readRawBody(req);
  const payload = rawBody ? JSON.parse(rawBody) : {};
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries;
}

export function toCsvRows(entries) {
  if (!Array.isArray(entries)) return [];

  const rows = [];
  for (const entry of entries) {
    if (entry?.type === "nick") {
      const nick = String(entry?.nick ?? "").trim();
      if (!nick) continue;
      rows.push(`nick,${escapeCsv(nick)}`);
      continue;
    }

    const elapsedMs = Math.max(0, Number(entry?.elapsedMs) || 0);
    const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
    const decision = Number(entry?.decision) === 1 ? 1 : 0;
    rows.push(`${elapsedSeconds},${decision}`);
  }

  return rows;
}

export function appendCsvHeader(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return CSV_HEADER;
  }
  return `${CSV_HEADER}${rows.join("\n")}\n`;
}

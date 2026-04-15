import { promises as fs } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const CSV_LOG_DIRECTORY = "logs";
const CSV_LOG_FILENAME = "decisions.csv";
const CSV_HEADER = "czas_zdarzenia_s,decyzja\n";

function escapeCsv(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function readRequestBody(req) {
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

function createDecisionLogMiddleware(rootPath) {
  const logDirectory = path.join(rootPath, CSV_LOG_DIRECTORY);
  const logPath = path.join(logDirectory, CSV_LOG_FILENAME);

  return async (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end();
      return;
    }

    try {
      const rawBody = await readRequestBody(req);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];

      if (entries.length === 0) {
        res.statusCode = 204;
        res.end();
        return;
      }

      const rows = entries.map((entry) => {
        if (entry?.type === "nick") {
          const nick = String(entry?.nick ?? "").trim();
          return `nick,${escapeCsv(nick)}`;
        }

        const elapsedMs = Math.max(0, Number(entry?.elapsedMs) || 0);
        const elapsedSeconds = (elapsedMs / 1000).toFixed(1);
        const decision = Number(entry?.decision) === 1 ? 1 : 0;
        return `${elapsedSeconds},${decision}`;
      });

      await fs.mkdir(logDirectory, { recursive: true });
      try {
        await fs.access(logPath);
      } catch {
        await fs.writeFile(logPath, CSV_HEADER, "utf8");
      }
      await fs.appendFile(logPath, `${rows.join("\n")}\n`, "utf8");

      res.statusCode = 204;
      res.end();
    } catch {
      res.statusCode = 400;
      res.end("Invalid decision log payload.");
    }
  };
}

function decisionCsvPlugin() {
  return {
    name: "decision-csv-plugin",
    configureServer(server) {
      server.middlewares.use("/api/decision-log", createDecisionLogMiddleware(server.config.root));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/decision-log", createDecisionLogMiddleware(server.config.root));
    },
  };
}

export default defineConfig({
  plugins: [react(), decisionCsvPlugin()],
});

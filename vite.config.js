import { promises as fs } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const CSV_LOG_DIRECTORY = "logs";
const DECISION_CSV_LOG_FILENAME = "decisions.csv";
const RUN_SUMMARY_CSV_LOG_FILENAME = "run-summaries.csv";
const DECISION_CSV_HEADER = "czas_zdarzenia_s,decyzja\n";
const RUN_SUMMARY_CSV_HEADER =
  "nick,session_id,started_at,finished_at,result,last_level,completed_levels,total_decisions,ones,zeros,total_earned,bank\n";

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
  const decisionsLogPath = path.join(logDirectory, DECISION_CSV_LOG_FILENAME);
  const summariesLogPath = path.join(logDirectory, RUN_SUMMARY_CSV_LOG_FILENAME);

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
      const runSummary =
        payload?.runSummary && typeof payload.runSummary === "object" ? payload.runSummary : null;
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];

      if (!runSummary && entries.length === 0) {
        res.statusCode = 204;
        res.end();
        return;
      }

      await fs.mkdir(logDirectory, { recursive: true });

      if (runSummary) {
        const row = [
          escapeCsv(String(runSummary.nick ?? "").trim()),
          escapeCsv(String(runSummary.sessionId ?? "").trim()),
          escapeCsv(String(runSummary.startedAt ?? "").trim()),
          escapeCsv(String(runSummary.finishedAt ?? "").trim()),
          escapeCsv(runSummary.success ? "win" : "fail"),
          Math.max(0, Number(runSummary.lastLevel) || 0),
          Math.max(0, Number(runSummary.completedLevels) || 0),
          Math.max(0, Number(runSummary.totalDecisions) || 0),
          Math.max(0, Number(runSummary.ones) || 0),
          Math.max(0, Number(runSummary.zeros) || 0),
          Math.max(0, Number(runSummary.totalEarned) || 0),
          Math.max(0, Number(runSummary.bank) || 0),
        ].join(",");

        try {
          await fs.access(summariesLogPath);
        } catch {
          await fs.writeFile(summariesLogPath, RUN_SUMMARY_CSV_HEADER, "utf8");
        }
        await fs.appendFile(summariesLogPath, `${row}\n`, "utf8");

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

      try {
        await fs.access(decisionsLogPath);
      } catch {
        await fs.writeFile(decisionsLogPath, DECISION_CSV_HEADER, "utf8");
      }
      await fs.appendFile(decisionsLogPath, `${rows.join("\n")}\n`, "utf8");

      res.statusCode = 204;
      res.end();
    } catch {
      res.statusCode = 400;
      res.end("Invalid decision log payload.");
    }
  };
}

function createDecisionLogCsvReadMiddleware(rootPath) {
  const logPath = path.join(rootPath, CSV_LOG_DIRECTORY, RUN_SUMMARY_CSV_LOG_FILENAME);

  return async (req, res) => {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.end();
      return;
    }

    try {
      let csvText;
      try {
        csvText = await fs.readFile(logPath, "utf8");
      } catch {
        csvText = RUN_SUMMARY_CSV_HEADER;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(csvText);
    } catch {
      res.statusCode = 500;
      res.end("Failed to read decision CSV.");
    }
  };
}

function decisionCsvPlugin() {
  return {
    name: "decision-csv-plugin",
    configureServer(server) {
      server.middlewares.use("/api/decision-log", createDecisionLogMiddleware(server.config.root));
      server.middlewares.use("/api/decision-log-csv", createDecisionLogCsvReadMiddleware(server.config.root));
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/decision-log", createDecisionLogMiddleware(server.config.root));
      server.middlewares.use("/api/decision-log-csv", createDecisionLogCsvReadMiddleware(server.config.root));
    },
  };
}

export default defineConfig({
  plugins: [react(), decisionCsvPlugin()],
});

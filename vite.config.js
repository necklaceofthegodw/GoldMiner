import { promises as fs } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createMinerNickHandler } from "./api/miner-nick.js";
import { createArmHandler } from "./api/arm.js";
import launchHandler from "./api/launch.js";
import {
  createPrefixRestoreMiddleware,
  createRootRedirectMiddleware,
  isTruthyFlag,
  normalizeBasePath,
} from "./api/_basePath.js";

const CSV_LOG_DIRECTORY = "logs";
const DECISION_CSV_LOG_FILENAME = "decisions.csv";
const RUN_SUMMARY_CSV_LOG_FILENAME = "run-summaries.csv";
// Written into the build output so "vite preview" can detect a build made for another BASE_PATH.
const BASE_MARKER_FILENAME = ".base-path";
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

function mountServerRoutes(server, { token, armHandler, stripped }) {
  const base = server.config.base;
  if (base !== "/") {
    // Must run before Vite's own middlewares, so they are registered directly in the hook.
    // Stripping proxy: "/x" -> "<prefix>/x" first, so "/" is the game root and is not redirected.
    if (stripped) server.middlewares.use(createPrefixRestoreMiddleware(base));
    server.middlewares.use(createRootRedirectMiddleware(base));
  }
  const api = `${base}api`;
  server.middlewares.use(`${api}/launch`, launchHandler);
  server.middlewares.use(`${api}/arm`, armHandler);
  server.middlewares.use(`${api}/miner-nick`, createMinerNickHandler(token));
  server.middlewares.use(`${api}/decision-log`, createDecisionLogMiddleware(server.config.root));
  server.middlewares.use(`${api}/decision-log-csv`, createDecisionLogCsvReadMiddleware(server.config.root));
  server.config.logger.info(`  Gold Miner base: ${base} (proxy strips prefix: ${stripped ? "yes" : "no"})`);
}

function decisionCsvPlugin(token, env) {
  const armHandler = createArmHandler(globalThis.fetch, env);
  const stripped = isTruthyFlag(env.BASE_PATH_STRIPPED);
  let resolvedConfig;
  const outDir = () => path.resolve(resolvedConfig.root, resolvedConfig.build.outDir);
  return {
    name: "decision-csv-plugin",
    configResolved(config) {
      resolvedConfig = config;
    },
    async closeBundle() {
      if (resolvedConfig.command !== "build") return;
      await fs.writeFile(path.join(outDir(), BASE_MARKER_FILENAME), resolvedConfig.base, "utf8");
    },
    configureServer(server) {
      mountServerRoutes(server, { token, armHandler, stripped });
    },
    async configurePreviewServer(server) {
      let builtBase = null;
      try {
        builtBase = (await fs.readFile(path.join(outDir(), BASE_MARKER_FILENAME), "utf8")).trim();
      } catch { /* Build made before the marker existed. */ }
      if (builtBase !== server.config.base) {
        throw new Error(
          `The build in "${resolvedConfig.build.outDir}" was made for base path "${builtBase ?? "unknown"}", ` +
          `but BASE_PATH is now "${server.config.base}". Delete the "${resolvedConfig.build.outDir}" folder ` +
          "(start.bat rebuilds it) or run the build again.",
        );
      }
      mountServerRoutes(server, { token, armHandler, stripped });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  return {
    // Public URL prefix (reverse proxy), e.g. /game/goldminer/. "/" serves the game at the root.
    base: normalizeBasePath(env.BASE_PATH),
    plugins: [react(), decisionCsvPlugin(env.BLOB_READ_WRITE_TOKEN, env)],
  };
});

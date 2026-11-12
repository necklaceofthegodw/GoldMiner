import { ARM_ENDPOINTS } from "../src/game/armEndpoints.js";

// Fixed destinations only. Never accept an arbitrary URL from a client.
export function createArmHandler(fetchImpl = globalThis.fetch, env = process.env) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const query = new URL(req.url, "http://localhost").searchParams;
    const arm = query.get("arm");
    const health = query.get("resource") === "health";
    if (!Object.hasOwn(ARM_ENDPOINTS, arm)) {
      res.statusCode = 400;
      res.end("Select alice or bob");
      return;
    }
    if (req.method !== (health ? "GET" : "POST")) {
      res.setHeader("Allow", health ? "GET" : "POST");
      res.statusCode = 405;
      res.end();
      return;
    }
    const headers = {};
    const prefix = `ARM_${arm.toUpperCase()}`;
    const configuredUrl = env[`${prefix}_URL`] || ARM_ENDPOINTS[arm];
    if (!health) {
      if (!env[`${prefix}_API_KEY`]?.trim()) {
        res.statusCode = 503;
        res.end("Arm API key is not configured on the server");
        return;
      }
      headers["x-api-key"] = env[`${prefix}_API_KEY`].trim();
      for (const name of ["x-game-id", "x-player-id"]) {
        const value = req.headers[name];
        if (typeof value !== "string" || !/^[\x20-\x7e]+$/.test(value)) {
          res.statusCode = 400;
          res.end("Missing or invalid experiment headers");
          return;
        }
        headers[name] = value;
      }
      headers["content-type"] = "application/json";
    }
    try {
      let body;
      if (!health) {
        // Vercel parses JSON bodies; Vite supplies a raw Node request stream.
        if (req.body !== undefined) {
          body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        } else {
          body = "";
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 16384) break;
          }
        }
        if (Buffer.byteLength(body) > 16384) {
          res.statusCode = 413;
          res.end();
          return;
        }
        const payload = JSON.parse(body);
        if (payload?.bit !== 0 && payload?.bit !== 1) {
          res.statusCode = 400;
          res.end("Invalid bit");
          return;
        }
      }
      const url = new URL(configuredUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("Invalid arm URL");
      const endpoint = health ? configuredUrl.replace(/\/data\/?$/, "/health") : configuredUrl;
      const upstream = await fetchImpl(endpoint, {
        method: req.method, headers, ...(health ? {} : { body }),
        redirect: "error", signal: AbortSignal.timeout(4000),
      });
      // No retries here: the existing client owns retries and decision order.
      res.statusCode = upstream.status;
      res.end(health ? await upstream.text() : undefined);
    } catch (error) {
      res.statusCode = error instanceof SyntaxError ? 400 : 502;
      res.end("Arm request failed");
    }
  };
}

export default createArmHandler();

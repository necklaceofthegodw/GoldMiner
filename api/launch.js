import { PORTAL_LAUNCH_KEY, validatePortalLaunch } from "../src/game/portalLaunch.js";

export default async function launchHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405; res.end("POST required"); return;
  }
  try {
    let raw = req.body;
    if (raw === undefined) {
      raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 16384) throw new Error("Body too large");
      }
    }
    if (typeof raw === "string") {
      if (Buffer.byteLength(raw) > 16384) throw new Error("Body too large");
      raw = req.headers["content-type"]?.includes("application/x-www-form-urlencoded")
        ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw);
    }
    const launch = validatePortalLaunch(raw);
    const json = JSON.stringify(JSON.stringify(launch)).replace(/</g, "\\u003c");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.statusCode = 200;
    // Browser navigation by POST: save the five fields in this tab, then load the SPA.
    // "../" is relative to <prefix>/api/launch, so it opens <prefix>/ whatever the prefix or proxy mode.
    res.end(`<!doctype html><html><meta charset="utf-8"><title>Gold Miner</title><body><p id="status">Opening game…</p><script>try{sessionStorage.setItem(${JSON.stringify(PORTAL_LAUNCH_KEY)},${json});location.replace('../');}catch{document.getElementById('status').textContent='Please enable browser storage and open the game from the portal again.'}</script></body></html>`);
  } catch {
    res.statusCode = 400; res.end("Invalid portal launch: playerId, armEndpoint, returnEndpoint, startAt and endAt are required; slot must exceed 10 seconds.");
  }
}

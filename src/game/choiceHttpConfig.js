import { readPortalLaunch } from "./portalLaunch.js";

function isHeaderValue(value) {
  return typeof value === "string" && /^[\x20-\x7e]+$/.test(value);
}

export function isChoiceHttpConfigured(config) {
  let serverKey = false;
  try {
    const url = new URL(config.endpoint);
    serverKey = url.origin === globalThis.location?.origin && url.pathname === "/api/arm" &&
      Boolean(url.searchParams.get("armEndpoint"));
  } catch { /* Invalid endpoint remains unconfigured. */ }
  return Boolean(config?.endpoint) &&
    isHeaderValue(config.gameId) && isHeaderValue(config.playerId) && (serverKey || isHeaderValue(config.apiKey));
}

// Portal input comes exclusively from POST /api/launch, stored in this tab.
// Runtime config is retained only for standalone development/custom receivers.
export function readChoiceHttpConfig({
  location = globalThis.location,
  launch = readPortalLaunch(),
  runtime = globalThis.GOLDMINER_CHOICE_CONFIG ?? {},
} = {}) {
  if (launch) {
    return {
      endpoint: launch.invalid ? "" : `${location.origin}/api/arm?armEndpoint=${encodeURIComponent(launch.armEndpoint)}`,
      gameId: "goldminer", playerId: launch.invalid ? "" : launch.playerId, apiKey: "",
    };
  }
  let endpoint = "";
  try {
    const url = new URL(runtime.endpoint);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && location?.protocol !== "https:";
    if ((url.protocol === "https:" || local) && !url.username && !url.password && !url.hash) endpoint = url.href;
  } catch { /* No portal launch: local standalone game. */ }
  return { endpoint, gameId: "goldminer", playerId: String(runtime.playerId ?? "").trim(), apiKey: String(runtime.apiKey ?? "").trim() };
}

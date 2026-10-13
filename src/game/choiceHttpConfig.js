function isHeaderValue(value) {
  return typeof value === "string" && /^[\x20-\x7e]+$/.test(value);
}

export function isChoiceHttpConfigured(config) {
  return Boolean(config?.endpoint) &&
    isHeaderValue(config.gameId) && isHeaderValue(config.playerId) && isHeaderValue(config.apiKey);
}

// Portal parameters override runtime configuration, then public Vite defaults.
// Credentials are accepted only at runtime, never from build variables or the query string.
export function readChoiceHttpConfig({
  location = globalThis.location,
  history = globalThis.history,
  runtime = globalThis.GOLDMINER_CHOICE_CONFIG ?? {},
  env = import.meta.env ?? {},
} = {}) {
  const query = new URLSearchParams(location?.search ?? "");
  const fragment = new URLSearchParams((location?.hash ?? "").replace(/^#/, ""));
  const fragmentKey = fragment.get("ChoiceApiKey") ?? "";
  if (fragment.has("ChoiceApiKey")) {
    fragment.delete("ChoiceApiKey");
    const remaining = fragment.toString();
    // Consume the launch credential once. It stays in memory, not in saved URLs.
    history?.replaceState(history.state, "", `${location.pathname}${location.search}${remaining ? `#${remaining}` : ""}`);
  }
  const endpoint = String(query.get("ChoiceUrl") ?? runtime.endpoint ?? env.VITE_GOLDMINER_CHOICE_URL ?? "").trim();
  let validEndpoint = "";
  try {
    const url = new URL(endpoint);
    const localHttp = url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && location?.protocol !== "https:";
    if ((url.protocol === "https:" || localHttp) && !url.username && !url.password &&
      !url.hash && !/[\r\n]/.test(endpoint)) {
      validEndpoint = endpoint; // Preserve the exact endpoint path and trailing slash.
    }
  } catch {
    // Missing/invalid configuration leaves the local decision log available.
  }
  return {
    endpoint: validEndpoint,
    gameId: String(query.get("ChoiceGameId") ?? runtime.gameId ?? env.VITE_GOLDMINER_GAME_ID ?? "goldminer").trim(),
    playerId: String(query.get("ChoicePlayerId") ?? runtime.playerId ?? env.VITE_GOLDMINER_PLAYER_ID ?? "").trim(),
    apiKey: String(runtime.apiKey ?? fragmentKey).trim(),
  };
}

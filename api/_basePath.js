// Server-side helpers for serving the game under a URL prefix behind a reverse proxy.
// Used by vite.config.js (dev + preview). Files starting with "_" are not Vercel functions.

export const DEFAULT_BASE_PATH = "/game/goldminer";

/** "game/goldminer", "/game/goldminer/" -> "/game/goldminer/"; "" or "/" -> "/". */
export function normalizeBasePath(value = DEFAULT_BASE_PATH) {
  const trimmed = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

export function isTruthyFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

/**
 * For proxies that strip the prefix (/game/goldminer/x -> /x): restore it on the incoming
 * request so the rest of the server (API routes, Vite static files) always sees prefixed URLs.
 */
export function createPrefixRestoreMiddleware(base) {
  const prefix = base.slice(0, -1);
  return (req, _res, next) => {
    const url = req.url || "/";
    const pathname = url.split("?")[0];
    if (pathname !== prefix && !pathname.startsWith(base)) req.url = prefix + (url.startsWith("/") ? url : `/${url}`);
    next();
  };
}

/** Send a bare "/" (proxy keeping the prefix) and "<prefix>" without the slash to "<prefix>/". */
export function createRootRedirectMiddleware(base) {
  const prefix = base.slice(0, -1);
  return (req, res, next) => {
    const [path, query] = (req.url || "/").split(/\?(.*)/s);
    if ((path !== "/" && path !== prefix) || (req.method !== "GET" && req.method !== "HEAD")) return next();
    res.statusCode = 302;
    res.setHeader("Location", base + (query ? `?${query}` : ""));
    res.end();
  };
}

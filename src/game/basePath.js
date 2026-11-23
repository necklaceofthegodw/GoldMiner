// Public URL prefix of the app (Vite "base", from BASE_PATH), always ending with "/".
// Falls back to "/" outside Vite (node --test).
export const BASE_URL = import.meta.env?.BASE_URL ?? "/";

/** appUrl("/assets/x.png") -> "/game/goldminer/assets/x.png" */
export function appUrl(path, base = BASE_URL) {
  return base + String(path).replace(/^\/+/, "");
}

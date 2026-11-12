export const PORTAL_LAUNCH_KEY = "goldminer:portal-launch:v1";

export function validatePortalLaunch(data) {
  if (!data || typeof data.playerId !== "string" || !/^[\x20-\x7e]+$/.test(data.playerId.trim())) throw new Error("Invalid playerId");
  const endpoint = (value) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid endpoint");
    return url.href;
  };
  const date = (value) => {
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid date");
    return new Date(value).toISOString();
  };
  const launch = { playerId: data.playerId.trim(), armEndpoint: endpoint(data.armEndpoint), portalEndpoint: endpoint(data.portalEndpoint), startAt: date(data.startAt), endAt: date(data.endAt) };
  if (Date.parse(launch.endAt) - Date.parse(launch.startAt) <= 10000) throw new Error("Slot must exceed 10 seconds");
  return launch;
}

export function readPortalLaunch() {
  try {
    const raw = globalThis.sessionStorage?.getItem(PORTAL_LAUNCH_KEY);
    return raw ? validatePortalLaunch(JSON.parse(raw)) : null;
  } catch { return { invalid: true }; }
}

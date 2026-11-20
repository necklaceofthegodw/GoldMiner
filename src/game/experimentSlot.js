import { readPortalLaunch } from "./portalLaunch.js";

export function readExperimentSlot(launch = readPortalLaunch()) {
  if (!launch) return null;
  if (launch.invalid) return { invalid: true };
  if (![launch.startAt, launch.endAt].every((value) => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return { invalid: true };
  const startAt = Date.parse(launch.startAt);
  const endAt = Date.parse(launch.endAt);
  return Number.isFinite(startAt) && Number.isFinite(endAt) && endAt - startAt > 10000
    ? { startAt, endAt, stopAt: endAt - 10000, returnEndpoint: launch.returnEndpoint } : { invalid: true };
}

export function getSlotStatus(slot, now = Date.now()) {
  if (!slot) return "unscheduled";
  if (slot.invalid) return "invalid";
  if (now >= slot.endAt) return "ended";
  if (now >= slot.stopAt) return "summary";
  return now < slot.startAt ? "waiting" : "active";
}

export function slotAllowsPlay(slot, now = Date.now()) {
  return ["active", "unscheduled"].includes(getSlotStatus(slot, now));
}

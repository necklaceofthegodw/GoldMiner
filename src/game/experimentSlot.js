// Portal dates must be ISO 8601 with an explicit timezone (UTC Z recommended).
export function readExperimentSlot(location = globalThis.location) {
  const query = new URLSearchParams(location?.search ?? "");
  const start = query.get("ChoiceStartAt") ?? query.get("startAt");
  const end = query.get("ChoiceEndAt") ?? query.get("endAt");
  if (start === null && end === null) return null;
  const parse = (value) => typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value) : NaN;
  const startAt = parse(start);
  const endAt = parse(end);
  return Number.isFinite(startAt) && Number.isFinite(endAt) && endAt > startAt
    ? { startAt, endAt } : { invalid: true };
}

export function getSlotStatus(slot, now = Date.now()) {
  if (!slot) return "unscheduled";
  if (slot.invalid) return "invalid";
  if (now >= slot.endAt) return "ended";
  return now < slot.startAt ? "waiting" : "active";
}

export function slotAllowsPlay(slot, now = Date.now()) {
  return ["active", "unscheduled"].includes(getSlotStatus(slot, now));
}

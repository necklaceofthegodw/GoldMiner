import { test } from "node:test";
import assert from "node:assert/strict";
import { readExperimentSlot, getSlotStatus, slotAllowsPlay } from "../src/game/experimentSlot.js";

const start = "2026-11-12T12:00:00Z";
const end = "2026-11-12T12:10:00Z";
const location = (startAt, endAt) => ({startAt,endAt,returnEndpoint:"https://portal.example/"});

test("portal slot waits, opens exactly at start and closes exactly at end", () => {
  const slot = readExperimentSlot(location(start,end));
  assert.equal(getSlotStatus(slot, slot.startAt - 1), "waiting");
  assert.equal(slotAllowsPlay(slot,slot.startAt-1),false);
  assert.equal(getSlotStatus(slot, slot.startAt), "active");
  assert.equal(slotAllowsPlay(slot,slot.stopAt-1),true);
  assert.equal(getSlotStatus(slot, slot.stopAt), "summary");
  assert.equal(slotAllowsPlay(slot,slot.stopAt),false);
  assert.equal(getSlotStatus(slot, slot.endAt), "ended");
  assert.equal(slotAllowsPlay(slot,slot.endAt),false);
  assert.equal(getSlotStatus(slot, slot.endAt + 60000), "ended");
});

test("missing half, invalid dates, timezone and reverse or empty slots fail closed", () => {
  for (const [a,b] of [[start,start],[end,start],["bad",end],[start,""],["2026-11-12T12:00:00",end]]) {
    const slot = readExperimentSlot(location(a,b));
    assert.equal(getSlotStatus(slot),"invalid");
    assert.equal(slotAllowsPlay(slot),false);
  }
  assert.equal(getSlotStatus(readExperimentSlot({startAt:start})),"invalid");
});

test("timezone offsets and portal aliases work; launches without slot keep normal mode", () => {
  assert.deepEqual(readExperimentSlot(location("2026-11-12T13:00:00+01:00","2026-11-12T13:10:00+01:00")),readExperimentSlot(location(start,end)));
  assert.equal(readExperimentSlot(null),null);
  assert.equal(getSlotStatus(null),"unscheduled");
  assert.equal(slotAllowsPlay(null),true);
});

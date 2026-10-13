import assert from "node:assert/strict";
import { test } from "node:test";

test("game event bridge sends each bit immediately, keeping portal ID separate from nickname", async (t) => {
  const values = new Map();
  const requests = [];
  const overrides = {
    GOLDMINER_CHOICE_CONFIG: {
      endpoint: "https://arm.example/exact/path/", gameId: "goldminer",
      playerId: "portal-participant", apiKey: "test-only-secret",
    },
    location: new URL("https://game.example/"),
    localStorage: {
      get length() { return values.size; },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { status: 204 };
    },
  };
  for (const [name, value] of Object.entries(overrides)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    });
  }
  const log = await import("../src/game/decisionLogClient.js");
  log.startDecisionSession("Nickname different from portal ID");
  const timestampGeneration = "2026-10-13T10:20:15.123Z";
  log.appendDecisionEntries([
    { elapsedMs: 2501, decision: 1, timestampGeneration },
    { elapsedMs: 5000, decision: 0, timestampGeneration },
  ]);
  assert.equal(requests.length, 1); // Starts before any level-end/finalization call.
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.url === "https://arm.example/exact/path/"));
  assert.ok(requests.every((request) => request.options.headers["X-Player-ID"] === "portal-participant"));
  const payloads = requests.map((request) => JSON.parse(request.options.body));
  assert.deepEqual(payloads.map((payload) => payload.bit), [1, 0]);
  assert.deepEqual(payloads.map((payload) => payload.metadata.sequence), ["1", "2"]);
  assert.equal(payloads[0].metadata.game_time, 2.501);
  assert.equal(payloads[0].timestamp_generation, timestampGeneration);
  const saved = JSON.parse(values.get("goldminer:decision-detail:v1"));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].nick, "Nickname different from portal ID");
  assert.equal(saved[0].sessionId, payloads[0].metadata.session_id);
  assert.equal(saved[0].loggedAt, timestampGeneration);
  assert.equal(values.size, 1); // ACK removed HTTP outbox entries, local detail remains.
  assert.ok([...values.values()].every((value) => !value.includes("test-only-secret")));
});

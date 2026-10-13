import assert from "node:assert/strict";
import { test } from "node:test";
import { CHOICE_OUTBOX_PREFIX, ChoiceHttpClient } from "../src/game/choiceHttpClient.js";
import { isChoiceHttpConfigured, readChoiceHttpConfig } from "../src/game/choiceHttpConfig.js";

const config = {
  endpoint: "https://arm.example/custom/arm/",
  gameId: "goldminer", playerId: "portal-player", apiKey: "test-only-secret",
};
const session = "37b948a6-607f-4260-8333-46577275e847";
const generatedAt = "2026-10-08T16:20:15.123Z";
const choice = { decision: 1, elapsedMs: 42500, timestampGeneration: generatedAt };

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

async function settle() {
  // Drain asynchronous request completions and the next request in the queue.
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function fixture(t, { storage = new MemoryStorage(), response = async () => ({ status: 204 }), configuration = config } = {}) {
  let time = Date.parse(generatedAt);
  let nextTimer = 0;
  const timers = new Map();
  const calls = [];
  const errors = [];
  const client = new ChoiceHttpClient(configuration, {
    storage,
    now: () => time,
    setTimer: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    reportError: (message) => errors.push(message),
    fetchImpl: (endpoint, options) => {
      calls.push({ endpoint, options, persisted: [...storage.values.values()] });
      return response(endpoint, options, calls.length);
    },
  });
  t.after(() => client.stop());
  return {
    client, storage, calls, errors, timers,
    async advance(milliseconds) {
      time += milliseconds;
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= time);
      for (const [id, timer] of due) {
        if (!timers.delete(id)) continue;
        timer.callback();
      }
      await settle();
    },
  };
}

test("each decision starts a separate POST immediately, with the exact Batyskaf contract", async (t) => {
  let finishFirst;
  const f = fixture(t, { response: (_url, _options, count) => count === 1
    ? new Promise((resolve) => { finishFirst = resolve; }) : Promise.resolve({ status: 204 }) });
  f.client.startSession(session);
  f.client.enqueue(choice);
  assert.equal(f.calls.length, 1); // No level transition, batching or debounce.
  f.client.enqueue({ ...choice, decision: 0, elapsedMs: 44001 });
  assert.equal(f.calls.length, 1); // Batyskaf's single request slot.
  const request = f.calls[0];
  assert.equal(request.endpoint, config.endpoint);
  assert.equal(request.options.method, "POST");
  assert.deepEqual(request.options.headers, {
    "Content-Type": "application/json", "X-Game-ID": "goldminer",
    "X-Player-ID": "portal-player", "X-API-Key": "test-only-secret",
  });
  assert.deepEqual(JSON.parse(request.options.body), {
    bit: 1, timestamp_generation: generatedAt,
    metadata: { session_id: session, sequence: "1", game_time: 42.5 },
  });
  assert.ok(request.persisted.length);
  assert.ok(request.persisted.every((row) => !row.includes(config.apiKey)));
  finishFirst({ status: 204 });
  await settle();
  assert.equal(f.calls.length, 2);
  const second = JSON.parse(f.calls[1].options.body);
  assert.equal(second.bit, 0);
  assert.equal(second.metadata.sequence, "2");
  assert.equal(second.metadata.game_time, 44.001);
  assert.equal(f.storage.length, 0);
});

test("all HTTP 2xx responses acknowledge receipt without an ACK JSON body", async (t) => {
  for (const status of [200, 201, 202, 204, 299]) {
    const f = fixture(t, { response: async () => ({ status }) });
    f.client.startSession();
    f.client.enqueue(choice);
    await settle();
    assert.equal(f.client.pending.size, 0);
    assert.equal(f.storage.length, 0);
  }
});

test("network errors, 408, 429 and 5xx retry with unchanged payload and capped backoff", async (t) => {
  const responses = [new Error("offline"), 408, 429, 503, 500, 503, 204];
  const f = fixture(t, { response: async (_url, _options, count) => {
    const result = responses[count - 1];
    if (result instanceof Error) throw result;
    return { status: result };
  } });
  f.client.startSession(session);
  f.client.enqueue(choice);
  await settle();
  for (const delay of [500, 1000, 2000, 4000, 8000, 10000]) {
    const before = f.calls.length;
    assert.equal(f.storage.length, 1);
    await f.advance(delay - 1);
    assert.equal(f.calls.length, before);
    await f.advance(1);
    assert.equal(f.calls.length, before + 1);
  }
  assert.ok(f.calls.every((call) => call.options.body === f.calls[0].options.body));
  assert.equal(f.storage.length, 0);
});

test("configuration errors retain a blocked decision without endless retries", async (t) => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    const f = fixture(t, { response: async () => ({ status }) });
    f.client.startSession(session);
    f.client.enqueue(choice);
    await settle();
    await f.advance(60000);
    assert.equal(f.calls.length, 1);
    assert.equal(f.storage.length, 1);
    assert.equal([...f.client.pending.values()][0].blocked, true);
    assert.ok(f.errors.every((message) => !message.includes(config.apiKey)));
  }
});

test("timeout aborts the request after 5 seconds and retains it for retry", async (t) => {
  const f = fixture(t, { response: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  }) });
  f.client.startSession(session);
  f.client.enqueue(choice);
  await f.advance(4999);
  assert.equal(f.calls[0].options.signal.aborted, false);
  await f.advance(1);
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.storage.length, 1);
  await f.advance(500);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.body, f.calls[0].options.body);
});

test("restart recovers original bytes only for the same endpoint, game and portal player", async (t) => {
  const first = fixture(t, { response: async () => ({ status: 401 }) });
  first.client.startSession(session);
  first.client.enqueue(choice);
  await settle();
  first.client.stop();
  for (const changed of [
    { endpoint: config.endpoint + "other" }, { gameId: "other-game" }, { playerId: "other-player" },
  ]) {
    const f = fixture(t, { storage: first.storage, configuration: { ...config, ...changed } });
    await settle();
    assert.equal(f.calls.length, 0);
    assert.equal(f.storage.length, 1);
  }
  const recovered = fixture(t, { storage: first.storage });
  await settle();
  assert.equal(recovered.calls.length, 1);
  assert.equal(recovered.calls[0].options.body, first.calls[0].options.body);
  assert.equal(first.storage.length, 0);
});

test("a new run does not discard pending decisions or alter their session", async (t) => {
  let resolveFirst;
  const f = fixture(t, { response: (_url, _options, count) => count === 1
    ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve({ status: 204 }) });
  f.client.startSession(session);
  f.client.enqueue(choice);
  const nextSession = f.client.startSession();
  f.client.enqueue(choice);
  resolveFirst({ status: 204 });
  await settle();
  assert.equal(JSON.parse(f.calls[0].options.body).metadata.session_id, session);
  assert.equal(JSON.parse(f.calls[1].options.body).metadata.session_id, nextSession);
  assert.equal(JSON.parse(f.calls[1].options.body).metadata.sequence, "1");
});

test("storage failure delays transmission until the decision can be persisted", async (t) => {
  const storage = new MemoryStorage();
  const setItem = storage.setItem.bind(storage);
  storage.setItem = () => { throw new Error("quota"); };
  const f = fixture(t, { storage });
  f.client.startSession(session);
  f.client.enqueue(choice);
  await settle();
  assert.equal(f.calls.length, 0);
  assert.equal(f.client.pending.size, 1);
  storage.setItem = setItem;
  await f.advance(500);
  assert.equal(f.calls.length, 1);
  assert.equal(f.storage.length, 0);
});

test("cleanup failure retries cleanup without another POST after acknowledgment", async (t) => {
  const storage = new MemoryStorage();
  const removeItem = storage.removeItem.bind(storage);
  storage.removeItem = () => { throw new Error("cleanup failed"); };
  const f = fixture(t, { storage });
  f.client.startSession(session);
  f.client.enqueue(choice);
  await settle();
  assert.equal(f.storage.length, 1);
  await f.advance(500);
  assert.equal(f.calls.length, 1);
  storage.removeItem = removeItem;
  await f.advance(500);
  assert.equal(f.calls.length, 1);
  assert.equal(f.storage.length, 0);
});

test("invalid and legacy outbox records are kept without sending or reassigning them", async (t) => {
  const storage = new MemoryStorage();
  storage.setItem(CHOICE_OUTBOX_PREFIX + "bad", "{");
  storage.setItem("goldminer:decision-detail:v1", JSON.stringify([{ nick: "local-nick", decision: 1 }]));
  const f = fixture(t, { storage });
  f.client.startSession(session);
  f.client.enqueue({ ...choice, decision: 2 });
  f.client.enqueue({ ...choice, elapsedMs: NaN });
  await settle();
  assert.equal(f.calls.length, 0);
  assert.equal(storage.length, 2);
});

test("missing API configuration sends nothing, with no fallback to Vercel Blob", async (t) => {
  for (const missing of ["endpoint", "gameId", "playerId", "apiKey"]) {
    const f = fixture(t, { configuration: { ...config, [missing]: "" } });
    f.client.startSession(session);
    f.client.enqueue(choice);
    await settle();
    assert.equal(f.calls.length, 0);
    assert.equal(f.storage.length, 0);
    assert.equal(f.errors.length, 1);
  }
});

test("portal launch parameters keep the exact endpoint and consume only the fragment credential", () => {
  const replaced = [];
  const location = new URL("https://game.example/?ChoiceUrl=https%3A%2F%2Farm.example%2Fcustom%2Farm%2F&ChoicePlayerId=portal-player&ChoiceGameId=goldminer#ChoiceApiKey=runtime-secret&other=keep");
  const result = readChoiceHttpConfig({
    location, history: { state: {}, replaceState: (...args) => replaced.push(args) },
    runtime: {}, env: { VITE_GOLDMINER_CHOICE_URL: "https://default.example/" },
  });
  assert.deepEqual(result, { ...config, apiKey: "runtime-secret" });
  assert.ok(isChoiceHttpConfigured(result));
  assert.equal(replaced.length, 1);
  assert.ok(!replaced[0][2].includes("runtime-secret"));
  assert.ok(replaced[0][2].endsWith("#other=keep"));
});

test("launch validation rejects public HTTP and invalid headers; no API key from build/query", () => {
  for (const endpoint of ["http://arm.example/", "https://user:password@arm.example/", "javascript:alert(1)"]) {
    assert.equal(readChoiceHttpConfig({ location: new URL("https://game.example/"), runtime: { ...config, endpoint }, env: {} }).endpoint, "");
  }
  const local = readChoiceHttpConfig({ location: new URL("http://localhost:5173/"), runtime: { ...config, endpoint: "http://127.0.0.1:8088/" }, env: {} });
  assert.equal(local.endpoint, "http://127.0.0.1:8088/");
  assert.equal(isChoiceHttpConfigured({ ...config, playerId: "bad\r\nHeader" }), false);
  const missing = readChoiceHttpConfig({ location: new URL("https://game.example/?ChoiceApiKey=query-secret"), runtime: {}, env: { VITE_GOLDMINER_CHOICE_API_KEY: "build-secret" } });
  assert.equal(missing.apiKey, "");
  assert.equal(missing.playerId, ""); // Nick/session never silently replaces portal identity.
});

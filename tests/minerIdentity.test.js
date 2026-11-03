import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateGlobalMinerNick } from "../api/_miner-counter.js";
import { createMinerNickHandler } from "../api/miner-nick.js";
import { allocateMinerNick } from "../src/game/minerIdentity.js";

test("concurrent participants receive distinct sequential names from shared storage", async () => {
  let current = null;
  const store = {
    read: async () => current && { ...current },
    compareAndSet: async (expected, next) => {
      if ((expected?.etag ?? null) !== (current?.etag ?? null)) return false;
      current = { lastNumber: next, etag: String(next) };
      return true;
    },
  };
  const names = await Promise.all(Array.from({ length: 10 }, () => allocateGlobalMinerNick(store, async () => {})));
  assert.equal(new Set(names).size, 10);
  assert.deepEqual(names.sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))),
    Array.from({ length: 10 }, (_, index) => `Miner${index + 1}`));
  assert.equal(await allocateGlobalMinerNick(store), "Miner11");
});

test("a corrupt or unavailable counter cannot fall back to Miner1", async () => {
  for (const lastNumber of [null, undefined, -1, "2", 1.5, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(allocateGlobalMinerNick({
      read: async () => ({ lastNumber, etag: "x" }),
      compareAndSet: () => assert.fail("Corrupt counter must not be overwritten"),
    }));
  }
  await assert.rejects(allocateGlobalMinerNick({ read: async () => { throw new Error("offline"); } }));
});

test("server requires POST and configured storage, without exposing credentials", async () => {
  const handler = createMinerNickHandler("");
  for (const [method, expected] of [["GET", 405], ["POST", 503]]) {
    const headers = {};
    const res = { setHeader: (name, value) => { headers[name] = value; }, end(body) { this.body = body; } };
    await handler({ method }, res);
    assert.equal(res.statusCode, expected);
    assert.equal(headers["Cache-Control"], "no-store");
    assert.ok(!JSON.parse(res.body).nick);
  }
});

test("browser accepts server names and fails closed on service errors", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/miner-nick");
    assert.equal(options.method, "POST");
    return { ok: true, json: async () => ({ nick: "Miner42" }) };
  });
  assert.equal(await allocateMinerNick(), "Miner42");
  fetch.mock.mockImplementation(async () => ({ ok: false }));
  await assert.rejects(allocateMinerNick());
  fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ nick: "Miner0" }) }));
  await assert.rejects(allocateMinerNick());
});

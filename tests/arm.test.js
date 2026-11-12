import { test } from "node:test";
import assert from "node:assert/strict";
import { createArmHandler } from "../api/arm.js";
import { readChoiceHttpConfig, isChoiceHttpConfigured } from "../src/game/choiceHttpConfig.js";
import { ARM_ENDPOINTS } from "../src/game/armEndpoints.js";

test("both POLSL arms use the same-origin relay with server credentials", () => {
  for (const arm of ["alice", "bob"]) {
    for (const protocol of ["http:", "https:"]) {
      const location = new URL(`${protocol}//game.example/?ChoiceArm=${arm}&ChoicePlayerId=p`);
      const config = readChoiceHttpConfig({ location, runtime: { apiKey: "key" }, env: {} });
      assert.equal(config.endpoint, `${location.origin}/api/arm?arm=${arm}`);
      assert.equal(config.playerId, "p");
      const explicit = readChoiceHttpConfig({ location, runtime: { endpoint: ARM_ENDPOINTS[arm] }, env: {} });
      assert.equal(explicit.endpoint, config.endpoint);
    }
  }
  assert.equal(readChoiceHttpConfig({location: new URL("https://game.example/?ChoiceArm=unknown"), runtime: {}, env: {}}).endpoint, "");
});

function response() {
  return { setHeader() {}, end(body) { this.body = body; } };
}

test("relay launches need portal identity but no browser API key", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {value: new URL("https://game.example/"), configurable: true});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "location", previous);
    else delete globalThis.location;
  });
  const config = readChoiceHttpConfig({location: new URL("https://game.example/?ChoiceArm=alice&ChoicePlayerId=participant"), runtime: {}, env: {}});
  assert.equal(config.apiKey, "");
  assert.equal(isChoiceHttpConfigured(config), true);
  assert.equal(isChoiceHttpConfigured({...config,playerId:""}), false);
  assert.equal(isChoiceHttpConfigured({...config,endpoint:"https://other.example/api/arm?arm=alice"}), false);
});

test("relay reads custom arm URL from backend env and fails closed without key", async () => {
  const req = {url:"/?arm=alice",method:"POST",headers:{"x-game-id":"goldminer","x-player-id":"p"},body:{bit:0}};
  const missing = response();
  await createArmHandler(() => assert.fail("No key must prevent sending"), {})(req,missing);
  assert.equal(missing.statusCode,503);
  const res = response();
  await createArmHandler(async (url, options) => {
    assert.equal(url,"http://arm.internal:8001/api/v1/data");
    assert.equal(options.headers["x-api-key"],"private-key");
    return {status:204};
  },{ARM_ALICE_URL:"http://arm.internal:8001/api/v1/data",ARM_ALICE_API_KEY:"private-key"})(req,res);
  assert.equal(res.statusCode,204);
});

test("relay preserves JSON and experiment headers, forwards ACK/failure without retry", async () => {
  const body = JSON.stringify({bit: 1, timestamp_generation: "2026-11-12T10:00:00.000Z", metadata: {sequence: "1"}});
  for (const status of [204, 401, 429, 503]) {
    let calls = 0;
    const handler = createArmHandler(async (url, options) => {
      calls++;
      assert.equal(url, ARM_ENDPOINTS.bob);
      assert.equal(options.body, body);
      assert.equal(options.headers["x-player-id"], "portal-player");
      assert.equal(options.headers["x-game-id"], "goldminer");
      assert.equal(options.headers["x-api-key"], "server-key");
      return { status };
    }, { ARM_BOB_API_KEY: "server-key" });
    const res = response();
    await handler({url: "/api/arm?arm=bob", method: "POST", headers: {"x-game-id":"goldminer", "x-player-id":"portal-player", "x-api-key":"key"}, body}, res);
    assert.equal(res.statusCode, status);
    assert.equal(calls, 1);
  }
});

test("health returns upstream status and ok; invalid targets/headers never contact arm", async () => {
  const handler = createArmHandler(async (url) => {
    assert.equal(url, ARM_ENDPOINTS.alice.replace(/\/data$/, "/health"));
    return {status:200, text: async () => "ok"};
  });
  const res = response();
  await handler({url:"/?arm=alice&resource=health",method:"GET"}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "ok");
  const noFetch = createArmHandler(() => assert.fail("No upstream call expected"), { ARM_ALICE_API_KEY: "server-key" });
  for (const [url,method,expected] of [["/?arm=https://evil.example", "POST",400], ["/?arm=alice","GET",405], ["/?arm=alice","POST",400]]) {
    const res = response();
    await noFetch({url,method,headers:{}},res);
    assert.equal(res.statusCode,expected);
  }
});

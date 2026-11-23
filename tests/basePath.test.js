import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BASE_PATH, createPrefixRestoreMiddleware, createRootRedirectMiddleware, isTruthyFlag, normalizeBasePath,
} from "../api/_basePath.js";
import { appUrl } from "../src/game/basePath.js";

test("base path is normalized to leading and trailing slashes", () => {
  assert.equal(DEFAULT_BASE_PATH, "/game/goldminer");
  assert.equal(normalizeBasePath(), "/game/goldminer/");
  assert.equal(normalizeBasePath("game/goldminer"), "/game/goldminer/");
  assert.equal(normalizeBasePath(" /game/goldminer// "), "/game/goldminer/");
  assert.equal(normalizeBasePath(""), "/");
  assert.equal(normalizeBasePath("/"), "/");
});

test("flags and client URLs", () => {
  for (const value of ["1", "true", "TRUE", "yes", "on"]) assert.equal(isTruthyFlag(value), true);
  for (const value of [undefined, "", "0", "false", "no"]) assert.equal(isTruthyFlag(value), false);
  assert.equal(appUrl("/assets/icons/gold.png", "/game/goldminer/"), "/game/goldminer/assets/icons/gold.png");
  assert.equal(appUrl("service-worker.js"), "/service-worker.js");
});

test("stripping proxy: prefix is restored on incoming requests", () => {
  const middleware = createPrefixRestoreMiddleware("/game/goldminer/");
  const rewrite = (url) => { const req = {url}; let called = false; middleware(req, {}, () => { called = true; }); assert.ok(called); return req.url; };
  assert.equal(rewrite("/api/launch"), "/game/goldminer/api/launch");
  assert.equal(rewrite("/"), "/game/goldminer/");
  assert.equal(rewrite("/?a=1"), "/game/goldminer/?a=1");
  assert.equal(rewrite("/assets/icons/gold.png"), "/game/goldminer/assets/icons/gold.png");
  assert.equal(rewrite("/game/goldminer/api/arm?arm=alice"), "/game/goldminer/api/arm?arm=alice");
  assert.equal(rewrite("/game/goldminer"), "/game/goldminer");
});

test("bare root and prefix without slash redirect to the prefix", () => {
  const middleware = createRootRedirectMiddleware("/game/goldminer/");
  const headers = {};
  const res = {setHeader(name, value) { headers[name] = value; }, end() { this.ended = true; }};
  middleware({url: "/", method: "GET"}, res, () => assert.fail("should redirect"));
  assert.equal(res.statusCode, 302);
  assert.equal(headers.Location, "/game/goldminer/");
  middleware({url: "/game/goldminer?x=1", method: "GET"}, res, () => assert.fail("should redirect"));
  assert.equal(headers.Location, "/game/goldminer/?x=1");
  let passed = false;
  middleware({url: "/game/goldminer/", method: "GET"}, res, () => { passed = true; });
  assert.ok(passed);
});

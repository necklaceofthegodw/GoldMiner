import { test } from "node:test";
import assert from "node:assert/strict";
import launchHandler from "../api/launch.js";
import { validatePortalLaunch } from "../src/game/portalLaunch.js";
import { createArmHandler } from "../api/arm.js";

const launch = {playerId:"participant",armEndpoint:"http://157.158.83.183:8001/api/v1/data",returnEndpoint:"https://portal.example/return",startAt:"2026-11-12T12:00:00Z",endAt:"2026-11-12T12:10:00Z"};
function response() {return {setHeader(){},end(body){this.body=body;}};}

test("POST launch accepts exactly the five portal fields as JSON or a navigation form",async()=>{
  for(const form of [false,true]) {
    const res=response();
    await launchHandler({method:"POST",headers:{"content-type":form?"application/x-www-form-urlencoded":"application/json"},body:form?new URLSearchParams(launch).toString():launch},res);
    assert.equal(res.statusCode,200);
    assert.ok(res.body.includes("sessionStorage.setItem"));
    assert.ok(res.body.includes("location.replace('../')"));
  }
});

test("invalid or incomplete launches fail and cannot inject HTML",async()=>{
  for(const body of [{...launch,playerId:""},{...launch,returnEndpoint:"javascript:alert(1)"},{...launch,endAt:launch.startAt},{...launch,startAt:"bad"}]) {
    const res=response();await launchHandler({method:"POST",body,headers:{}},res);assert.equal(res.statusCode,400);
  }
  const res=response();
  await launchHandler({method:"POST",body:{...launch,playerId:"</script><script>alert(1)</script>"},headers:{}},res);
  assert.equal(res.statusCode,200);
  assert.ok(!res.body.includes("</script><script>alert"));
  assert.throws(()=>validatePortalLaunch({...launch,startAt:"2026-11-12T12:00:00"}));
});

test("relay sends to the portal endpoint only when it matches a configured arm",async()=>{
  let called=0;
  const handler=createArmHandler(async(url)=>{called++;assert.equal(url,launch.armEndpoint);return{status:204};},{ARM_ALICE_URL:launch.armEndpoint});
  const req={url:`/?armEndpoint=${encodeURIComponent(launch.armEndpoint)}`,method:"POST",headers:{"x-player-id":"participant","x-game-id":"goldminer"},body:{bit:1}};
  const res=response();await handler(req,res);assert.equal(res.statusCode,204);assert.equal(called,1);
  const rejected=response();await handler({...req,url:"/?armEndpoint=http://unknown.example/data"},rejected);assert.equal(rejected.statusCode,400);assert.equal(called,1);
});

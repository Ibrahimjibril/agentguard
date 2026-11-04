import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "./app.ts";
import { SetupError } from "../setup/setup.ts";
import { openStore } from "../guard/store.ts";

function boot(over: any = {}) {
  let stage: any = { stage: "no_owner" };
  const calls: string[] = [];
  const guard: any = { store: openStore(":memory:"), chain: { listPending: async () => [], approve: async () => ({ ok: true, tx: null, error: null }), reject: async () => ({ ok: true, tx: null, error: null }), accountExists: async () => true }, trusted: [], knownBad: [], llm: null, vaultInfo: async () => null };
  let loaded = false;
  const app = createApp({
    setup: {
      status: () => stage,
      createOwner: async (name: any) => { calls.push(`owner:${name}`); if (name === "bad") throw new SetupError(422, "bad name"); stage = { stage: "owner_ready", owner: `${name}.testnet` }; return `${name}.testnet`; },
      deploy: async () => { calls.push("deploy"); await new Promise((r) => setTimeout(r, over.deployMs ?? 0)); stage = { stage: "deployed", owner: "x.testnet", vault: "vault.x.testnet", agent: "agent.x.testnet", guardian: "guardian.x.testnet", agentKeyFile: ".keys/agent.x.testnet.json" }; return {}; },
    },
    getGuard: () => (loaded ? guard : null),
    onDeployed: () => { loaded = true; },
    llmConfigured: false,
  });
  const server = http.createServer(app);
  return new Promise<any>((resolve) => server.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const j = async (path: string, init: any = {}) => { const r = await fetch(base + path, init); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const post = (path: string, body: any, origin = "http://localhost:3000") => j(path, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    resolve({ j, post, calls, close: () => server.close(), server });
  }));
}

test("setup status starts at no_owner and guard routes say create a sandbox first", async () => {
  const t = await boot();
  assert.equal((await t.j("/api/setup")).body.stage, "no_owner");
  const s = await t.j("/api/state");
  assert.equal(s.status, 409);
  assert.match(s.body.error, /No sandbox yet/);
  assert.equal((await t.j("/api/health")).status, 200);
  t.close();
});
test("the full wizard: create owner, deploy, then the guard routes work", async () => {
  const t = await boot();
  const o = await t.post("/api/setup/owner", { name: "alice-agents" });
  assert.equal(o.body.owner, "alice-agents.testnet");
  assert.equal((await t.j("/api/setup")).body.stage, "owner_ready");
  const d = await t.post("/api/setup/deploy", {});
  assert.equal(d.status, 200);
  assert.equal(d.body.stage, "deployed");
  assert.equal((await t.j("/api/state")).status, 200);
  t.close();
});
test("setup errors keep their status and message", async () => {
  const t = await boot();
  const r = await t.post("/api/setup/owner", { name: "bad" });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, "bad name");
  t.close();
});
test("two setup actions cannot run at once", async () => {
  const t = await boot({ deployMs: 150 });
  await t.post("/api/setup/owner", { name: "alice-agents" });
  const first = t.post("/api/setup/deploy", {});
  await new Promise((r) => setTimeout(r, 30));
  const second = await t.post("/api/setup/deploy", {});
  assert.equal(second.status, 409);
  assert.equal((await first).status, 200);
  t.close();
});
test("other websites cannot create accounts or deploy", async () => {
  const t = await boot();
  const r = await t.post("/api/setup/owner", { name: "alice-agents" }, "https://evil.example");
  assert.equal(r.status, 403);
  assert.deepEqual(t.calls, []);
  t.close();
});
test("a foreign Host header is refused on setup routes too", async () => {
  const t = await boot();
  const port = (t.server.address() as any).port;
  const status: number = await new Promise((resolve) => {
    const q = http.request({ host: "127.0.0.1", port, path: "/api/setup", headers: { host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    q.end();
  });
  assert.equal(status, 403);
  t.close();
});

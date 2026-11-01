import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { openStore } from "../guard/store.ts";
import { processAll } from "../guard/guard.ts";
import type { Chain, PendingReq } from "../guard/guard.ts";
import { createHandler } from "./api.ts";
import type { Policy } from "../policy/policy.ts";

const N = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const policy: Policy = { version: 1, per_tx_limit: N(2), daily_limit: N(5), approval_threshold: N(1.5), allowlist: [], allowlist_only: false, blocklist: [], risk_block_score: 70, risk_review_score: 40 };

async function boot(pending: PendingReq[] = [], llm: any = null) {
  const calls: string[] = [];
  const chain: Chain = {
    listPending: async () => pending,
    approve: async (id) => { calls.push(`approve:${id}`); return { ok: true, tx: "t", error: null }; },
    reject: async (id) => { calls.push(`reject:${id}`); return { ok: true, tx: "r", error: null }; },
    accountExists: async () => true,
  };
  const deps = { store: openStore(":memory:"), chain, trusted: ["owner.testnet"], knownBad: [], llm, vaultInfo: async () => ({ balanceNear: 5 }) };
  const server = http.createServer(createHandler(deps));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const j = async (path: string, init: any = {}) => {
    const r = await fetch(base + path, init);
    return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
  };
  const post = (path: string, body: unknown, origin = "http://localhost:3000") =>
    j(path, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  return { deps, calls, server, base, j, post, close: () => server.close() };
}

test("health and empty state", async () => {
  const t = await boot();
  assert.deepEqual((await t.j("/api/health")).body, { ok: true });
  const s = (await t.j("/api/state")).body;
  assert.equal(s.policy, null);
  assert.deepEqual(s.decisions, []);
  assert.equal(s.vault.balanceNear, 5);
  t.close();
});
test("activating a policy shows it in state with a code-written summary", async () => {
  const t = await boot();
  const r = await t.post("/api/policy/activate", { policy });
  assert.equal(r.status, 200);
  const s = (await t.j("/api/state")).body;
  assert.ok(s.policy.summary.some((l: string) => l.includes("Max per payment: 2 NEAR")));
  t.close();
});
test("invalid policy is rejected with reasons", async () => {
  const t = await boot();
  const r = await t.post("/api/policy/activate", { policy: { ...policy, risk_block_score: 999 } });
  assert.equal(r.status, 422);
  assert.ok(r.body.errors.length > 0);
  t.close();
});
test("a policy with no limits needs explicit confirmation", async () => {
  const t = await boot();
  const open = { ...policy, per_tx_limit: null, daily_limit: null, approval_threshold: null };
  const a = await t.post("/api/policy/activate", { policy: open });
  assert.equal(a.status, 409);
  assert.equal(a.body.needsConfirmation, true);
  assert.equal((await t.j("/api/state")).body.policy, null);
  const b = await t.post("/api/policy/activate", { policy: open, confirmUnlimited: true });
  assert.equal(b.status, 200);
  t.close();
});
test("compile uses the LLM but never activates anything", async () => {
  const llm = async () => JSON.stringify({ per_tx_limit_near: 3, daily_limit_near: 9 });
  const t = await boot([], llm);
  const r = await t.post("/api/policy/compile", { text: "max 3 per payment, 9 per day" });
  assert.equal(r.status, 200);
  assert.equal(r.body.policy.per_tx_limit, N(3));
  assert.equal((await t.j("/api/state")).body.policy, null);
  t.close();
});
test("compile without an LLM says so", async () => {
  const t = await boot();
  assert.equal((await t.post("/api/policy/compile", { text: "x" })).status, 503);
  t.close();
});
test("a human can approve a request that is awaiting approval", async () => {
  const t = await boot([{ id: 0, to: "shop.testnet", amount: N(1.8), memo: "m" }]);
  t.deps.store.setPolicy(policy);
  await processAll(t.deps);
  assert.equal((await t.j("/api/state")).body.awaiting, 1);
  const r = await t.post("/api/decisions/0/approve", {});
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "paid");
  assert.deepEqual(t.calls, ["approve:0"]);
  const again = await t.post("/api/decisions/0/approve", {});
  assert.equal(again.status, 409);
  t.close();
});
test("requests from other websites are refused", async () => {
  const t = await boot();
  const r = await t.post("/api/policy/activate", { policy }, "https://evil.example");
  assert.equal(r.status, 403);
  assert.equal((await t.j("/api/state")).body.policy, null);
  t.close();
});
test("allowed origin gets CORS headers", async () => {
  const t = await boot();
  const r = await t.j("/api/health", { headers: { origin: "http://localhost:3000" } });
  assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:3000");
  t.close();
});
test("a foreign Host header (DNS rebinding) is refused", async () => {
  const t = await boot();
  const port = (t.server.address() as any).port;
  const status: number = await new Promise((resolve) => {
    const q = http.request({ host: "127.0.0.1", port, path: "/api/state", headers: { host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    q.end();
  });
  assert.equal(status, 403);
  t.close();
});
test("oversized and malformed bodies are refused", async () => {
  const t = await boot();
  const big = await t.post("/api/policy/activate", { policy, pad: "x".repeat(70000) });
  assert.equal(big.status, 413);
  const bad = await t.j("/api/policy/activate", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: "{nope" });
  assert.equal(bad.status, 400);
  t.close();
});

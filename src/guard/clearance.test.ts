import { test } from "node:test";
import assert from "node:assert/strict";
import { openStore } from "./store.ts";
import { processAll, humanDecide } from "./guard.ts";
import type { Chain, PendingReq, Deps } from "./guard.ts";
import type { Policy } from "../policy/policy.ts";
import { parseClearance } from "./clearance.ts";

const N = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const policy: Policy = {
  version: 1, per_tx_limit: N(3), daily_limit: N(6), approval_threshold: N(2),
  allowlist: ["shop.testnet"], allowlist_only: false, blocklist: [],
  risk_block_score: 70, risk_review_score: 40,
};

function setup(pending: PendingReq[], certified?: () => Promise<boolean | null>) {
  const calls: string[] = [];
  const chain: Chain = {
    listPending: async () => pending,
    approve: async (id) => { calls.push(`approve:${id}`); return { ok: true, tx: `tx${id}`, error: null }; },
    reject: async (id) => { calls.push(`reject:${id}`); return { ok: true, tx: `rx${id}`, error: null }; },
    accountExists: async () => true,
  };
  const store = openStore(":memory:");
  store.setPolicy(policy);
  let reads = 0;
  const deps: Deps = {
    store, chain, trusted: ["owner.testnet"], knownBad: [], now: () => Date.UTC(2026, 10, 14, 12),
    certified: certified && (async () => { reads++; return certified(); }),
  };
  return { store, deps, calls, reads: () => reads };
}
const req = (id: number, to: string, amount: number): PendingReq => ({ id, to, amount: N(amount), memo: "t" + id });

test("clearance: a certified agent's payment is auto-approved as before", async () => {
  const { deps, calls } = setup([req(0, "shop.testnet", 1)], async () => true);
  const [o] = await processAll(deps);
  assert.equal(o.verdict, "allow");
  assert.deepEqual(calls, ["approve:0"]);
});

test("clearance: without a valid certificate (missing, expired, revoked) the payment goes to a human", async () => {
  const { store, deps, calls } = setup([req(0, "shop.testnet", 1)], async () => false);
  const [o] = await processAll(deps);
  assert.equal(o.verdict, "ask");
  assert.equal(o.status, "awaiting_approval");
  assert.ok(o.reasons[0].startsWith("AGENT_NOT_CERTIFIED"));
  assert.deepEqual(calls, []);
  assert.equal(await humanDecide(deps, 0, true), "paid");
  assert.deepEqual(calls, ["approve:0"]);
  assert.equal(store.getDecision(0)?.status, "paid");
});

test("clearance: if the certificate cannot be read, fail safe to a human", async () => {
  for (const certified of [async () => null, async () => { throw new Error("rpc down"); }]) {
    const { deps, calls } = setup([req(0, "shop.testnet", 1)], certified as () => Promise<boolean | null>);
    const [o] = await processAll(deps);
    assert.equal(o.verdict, "ask");
    assert.ok(o.reasons[0].startsWith("CERT_UNAVAILABLE"));
    assert.deepEqual(calls, []);
  }
});

test("clearance: a certificate never turns a block or an ask into an allow, and is read only for an allow", async () => {
  const { deps, calls, reads } = setup([req(0, "shop.testnet", 4), req(1, "shop.testnet", 2.5)], async () => true);
  const out = await processAll(deps);
  assert.equal(out[0].verdict, "block");
  assert.equal(out[1].verdict, "ask");
  assert.deepEqual(calls, ["reject:0"]);
  assert.equal(reads(), 0);
});

test("clearance: a certified agent's identical retry still goes to a human (duplicate check runs first)", async () => {
  const { deps, calls } = setup([req(0, "shop.testnet", 1), req(1, "shop.testnet", 1)], async () => true);
  const out = await processAll(deps);
  assert.equal(out[1].verdict, "ask");
  assert.ok(out[1].reasons[0].startsWith("DUPLICATE_RECENT"));
  assert.deepEqual(calls, ["approve:0"]);
});

test("clearance: no config means no certificate check", async () => {
  const { deps, calls } = setup([req(0, "shop.testnet", 1)]);
  const [o] = await processAll(deps);
  assert.equal(o.verdict, "allow");
  assert.deepEqual(calls, ["approve:0"]);
});

test("clearance: config is validated strictly", () => {
  const ok = parseClearance({ contract: "clearance-dev.testnet", agent: "clearance-agent-v8.testnet", signer: "lt-dopusk-ci-signer.testnet", level: 2 });
  assert.equal(ok.ok, true);
  for (const bad of [null, [], { contract: "x", agent: "a.testnet", signer: "s.testnet", level: 2 },
    { contract: "c.testnet", agent: "a.testnet", signer: "s.testnet", level: 3 },
    { contract: "c.testnet", agent: "a.testnet", signer: "s.testnet", level: 2, extra: 1 },
    { contract: "c.testnet", agent: "A B", signer: "s.testnet", level: 1 },
    { contract: "c.testnet", agent: "a.testnet", signer: "s.testnet", level: 1, network: "betanet" }]) {
    assert.equal(parseClearance(bad).ok, false, JSON.stringify(bad));
  }
});

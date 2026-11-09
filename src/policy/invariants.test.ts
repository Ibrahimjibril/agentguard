import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, isAccountId } from "./policy.ts";
import type { Policy } from "./policy.ts";

const Y = 10n ** 24n;

// Small deterministic random generator, so a failure can always be reproduced.
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(r: () => number, a: any[]): any { return a[Math.floor(r() * a.length)]; }

const ACCOUNTS = ["shop.testnet", "owner.testnet", "sh0p.testnet", "evil.testnet", "a.testnet", "bad account!", "", "UPPER.testnet"];
const AMOUNTS = ["0", "1", "5", "1000000000000000000000000", "2500000000000000000000000", "abc", "-5", "1.5", "", " 7"];

function randomPolicy(r: () => number): Policy {
  const lim = (): string | null => (r() < 0.25 ? null : ((BigInt(1 + Math.floor(r() * 6)) * Y) / 2n).toString());
  const accts = ["shop.testnet", "owner.testnet", "sh0p.testnet", "evil.testnet", "a.testnet"];
  const some = (): string[] => accts.filter(() => r() < 0.3);
  const review: number = pick(r, [30, 40, 50]);
  return {
    version: 1, per_tx_limit: lim(), daily_limit: lim(), approval_threshold: lim(),
    allowlist: some(), allowlist_only: r() < 0.3, blocklist: some(),
    risk_block_score: review + pick(r, [20, 30, 40]), risk_review_score: review,
  };
}

test("evaluate never allows a request that breaks any rule (20,000 random cases)", () => {
  const r = rng(20261105);
  let allows = 0;
  for (let i = 0; i < 20000; i++) {
    const p = randomPolicy(r);
    const to: string = pick(r, ACCOUNTS);
    const amount: string = pick(r, AMOUNTS);
    const spent = (BigInt(Math.floor(r() * 6)) * Y) / 2n;
    const risk = r() < 0.15 ? null : Math.floor(r() * 101);
    const d = evaluate(p, { to, amount }, { spentToday: spent, riskScore: risk });
    if (d.verdict !== "allow") continue;
    allows++;
    const ctx = JSON.stringify({ p, to, amount, spent: spent.toString(), risk });
    assert.ok(isAccountId(to), ctx);
    assert.match(amount, /^\d+$/, ctx);
    const a = BigInt(amount);
    assert.ok(a > 0n, ctx);
    if (p.per_tx_limit !== null) assert.ok(a <= BigInt(p.per_tx_limit), ctx);
    if (p.daily_limit !== null) assert.ok(spent + a <= BigInt(p.daily_limit), ctx);
    assert.ok(!p.blocklist.includes(to), ctx);
    if (p.allowlist_only) assert.ok(p.allowlist.includes(to), ctx);
    assert.ok(risk !== null && risk < p.risk_review_score, ctx);
    if (p.approval_threshold !== null) assert.ok(a <= BigInt(p.approval_threshold), ctx);
  }
  assert.ok(allows > 200, "the generator must produce enough ALLOW cases, got " + allows);
});

test("an invalid destination or amount is always blocked", () => {
  const r = rng(7);
  for (const to of ["", "bad account!", "UPPER.testnet", "a", "x".repeat(65)]) {
    for (const amount of ["0", "abc", "-1", "1.5", "", "1e24"]) {
      const d = evaluate(randomPolicy(r), { to, amount }, { spentToday: 0n, riskScore: 0 });
      assert.equal(d.verdict, "block", to + " | " + amount);
    }
  }
});

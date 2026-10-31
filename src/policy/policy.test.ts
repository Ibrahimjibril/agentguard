import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePolicy, evaluate, sumSpentToday, fmtNear } from "./policy.ts";
import type { Policy } from "./policy.ts";

const N = (n: number) => (BigInt(Math.round(n * 1000)) * 10n ** 21n).toString();
const base: Policy = {
  version: 1,
  per_tx_limit: N(5),
  daily_limit: N(10),
  approval_threshold: N(2),
  allowlist: ["shop.testnet"],
  allowlist_only: false,
  blocklist: ["scammer.testnet"],
  risk_block_score: 70,
  risk_review_score: 40,
};
const ctx = (spent = 0n, risk: number | null = 0) => ({ spentToday: spent, riskScore: risk });
const codes = (d: { reasons: { code: string }[] }) => d.reasons.map((r) => r.code);

test("valid policy parses", () => {
  assert.equal(parsePolicy(base).ok, true);
});
test("unknown or missing fields are rejected", () => {
  assert.equal(parsePolicy({ ...base, hack: 1 }).ok, false);
  const { daily_limit, ...rest } = base;
  assert.equal(parsePolicy(rest).ok, false);
});
test("bad values are rejected", () => {
  assert.equal(parsePolicy({ ...base, per_tx_limit: "-5" }).ok, false);
  assert.equal(parsePolicy({ ...base, allowlist: ["BAD ID"] }).ok, false);
  assert.equal(parsePolicy({ ...base, risk_block_score: 150 }).ok, false);
  assert.equal(parsePolicy({ ...base, approval_threshold: N(9) }).ok, false);
  assert.equal(parsePolicy({ ...base, allowlist: ["a.testnet"], blocklist: ["a.testnet"] }).ok, false);
});
test("small payment to allowlisted shop is allowed", () => {
  const d = evaluate(base, { to: "shop.testnet", amount: N(1) }, ctx());
  assert.equal(d.verdict, "allow");
});
test("over per-tx limit is blocked", () => {
  const d = evaluate(base, { to: "shop.testnet", amount: N(6) }, ctx());
  assert.equal(d.verdict, "block");
  assert.ok(codes(d).includes("OVER_PER_TX_LIMIT"));
});
test("one yoctoNEAR over the limit is blocked (BigInt precision)", () => {
  const over = (BigInt(N(5)) + 1n).toString();
  assert.equal(evaluate(base, { to: "shop.testnet", amount: over }, ctx()).verdict, "block");
  assert.notEqual(evaluate(base, { to: "shop.testnet", amount: N(5) }, ctx()).verdict, "block");
});
test("daily limit counts what was already spent", () => {
  const d = evaluate(base, { to: "shop.testnet", amount: N(1) }, ctx(BigInt(N(9.5))));
  assert.equal(d.verdict, "block");
  assert.ok(codes(d).includes("OVER_DAILY_LIMIT"));
});
test("above approval threshold asks a human", () => {
  const d = evaluate(base, { to: "shop.testnet", amount: N(3) }, ctx());
  assert.equal(d.verdict, "ask");
  assert.deepEqual(codes(d), ["APPROVAL_REQUIRED"]);
});
test("blocklisted destination is blocked", () => {
  assert.equal(evaluate(base, { to: "scammer.testnet", amount: N(1) }, ctx()).verdict, "block");
});
test("allowlist_only blocks unknown destinations", () => {
  const p = { ...base, allowlist_only: true };
  assert.equal(evaluate(p, { to: "other.testnet", amount: N(1) }, ctx()).verdict, "block");
  assert.equal(evaluate(p, { to: "shop.testnet", amount: N(1) }, ctx()).verdict, "allow");
});
test("risk score: high blocks, medium asks, unavailable asks", () => {
  const r = { to: "shop.testnet", amount: N(1) };
  assert.equal(evaluate(base, r, ctx(0n, 80)).verdict, "block");
  assert.equal(evaluate(base, r, ctx(0n, 50)).verdict, "ask");
  assert.equal(evaluate(base, r, ctx(0n, null)).verdict, "ask");
});
test("block wins over ask and all reasons are kept", () => {
  const d = evaluate(base, { to: "shop.testnet", amount: N(6) }, ctx(0n, 50));
  assert.equal(d.verdict, "block");
  assert.ok(codes(d).includes("OVER_PER_TX_LIMIT") && codes(d).includes("RISK_REVIEW"));
});
test("invalid requests fail closed", () => {
  for (const r of [
    { to: "NOT VALID", amount: N(1) },
    { to: "shop.testnet", amount: "abc" },
    { to: "shop.testnet", amount: "0" },
    { to: "shop.testnet", amount: "-1" },
  ]) assert.equal(evaluate(base, r, ctx()).verdict, "block");
});
test("daily total resets at 00:00 UTC", () => {
  const now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const entries = [
    { amount: N(3), ts: Date.UTC(2026, 10, 1, 23, 59, 59) }, // yesterday
    { amount: N(2), ts: Date.UTC(2026, 10, 2, 0, 0, 0) },
    { amount: N(1), ts: Date.UTC(2026, 10, 2, 9, 0, 0) },
  ];
  assert.equal(sumSpentToday(entries, now), BigInt(N(3)));
});
test("fmtNear is readable", () => {
  assert.equal(fmtNear(BigInt(N(1.5))), "1.5 NEAR");
  assert.equal(fmtNear(BigInt(N(2))), "2 NEAR");
});

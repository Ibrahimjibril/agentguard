import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDestination, levenshtein } from "./scam.ts";

const ctx = { trusted: ["shop.testnet", "owner.testnet"], knownBad: ["scammer.testnet"] };

test("levenshtein basics", () => {
  assert.equal(levenshtein("shop", "shop"), 0);
  assert.equal(levenshtein("shop", "sh0p"), 1);
  assert.equal(levenshtein("", "abc"), 3);
});
test("trusted account scores 0", () => {
  assert.equal(scoreDestination("shop.testnet", { exists: true }, ctx).score, 0);
});
test("known-bad scores 100 even if it exists", () => {
  assert.equal(scoreDestination("scammer.testnet", { exists: true }, ctx).score, 100);
});
test("lookalike of a trusted account is flagged", () => {
  const r = scoreDestination("sh0p.testnet", { exists: true }, ctx);
  assert.equal(r.score, 60);
  assert.match(r.reasons.join(" "), /Looks like trusted account shop\.testnet/);
});
test("non-existent named account is high risk, lookalike pushes it to 100", () => {
  assert.equal(scoreDestination("random-xyz.testnet", { exists: false }, ctx).score, 70);
  assert.equal(scoreDestination("sh0p.testnet", { exists: false }, ctx).score, 100);
});
test("new implicit account is only mildly risky", () => {
  const hex = "a".repeat(64);
  assert.equal(scoreDestination(hex, { exists: false }, ctx).score, 25);
});
test("phishing keywords add risk", () => {
  assert.equal(scoreDestination("free-claim.testnet", { exists: true }, ctx).score, 20);
});
test("existing unknown account with no signals is clean", () => {
  const r = scoreDestination("alice.testnet", { exists: true }, ctx);
  assert.equal(r.score, 0);
  assert.deepEqual(r.reasons, ["No risk signals found."]);
});
test("unverifiable destination returns null (fail safe)", () => {
  assert.equal(scoreDestination("alice.testnet", { exists: null }, ctx).score, null);
});

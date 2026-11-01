import { test } from "node:test";
import assert from "node:assert/strict";
import { findTx } from "./tx.ts";

test("finds the hash in a plain RPC result", () => {
  assert.equal(findTx({ transaction: { hash: "AAA" }, status: {} }), "AAA");
});
test("finds the hash inside a JSON-RPC envelope", () => {
  assert.equal(findTx({ jsonrpc: "2.0", result: { transaction: { hash: "BBB" } } }), "BBB");
});
test("falls back to the transaction outcome id", () => {
  assert.equal(findTx({ result: { transaction_outcome: { id: "CCC" } } }), "CCC");
});
test("returns null when there is nothing to find", () => {
  assert.equal(findTx(null), null);
  assert.equal(findTx({ a: [1, 2, { b: "x" }] }), null);
});

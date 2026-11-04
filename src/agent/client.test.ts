import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentClient, PAY_TOOL } from "./client.ts";

function make(opts: { rows?: any[]; sendResult?: any; total?: number } = {}) {
  const sent: any[] = [];
  let poll = 0;
  const rows = opts.rows ?? [{ status: "Paid" }];
  const near = {
    actions: { functionCall: (a: any) => ({ type: "Call", ...a }) },
    sendTx: async (a: any) => { sent.push(a); return opts.sendResult ?? { ok: true }; },
    view: async (a: any) => {
      if (a.methodName === "get_config") return { total_requests: opts.total ?? 7 };
      return rows[Math.min(poll++, rows.length - 1)];
    },
  };
  const client = createAgentClient({ vault: "vault.o.testnet", agent: "agent.o.testnet", privateKey: "k", near, pollMs: 0, sleep: async () => {} });
  return { client, sent };
}

test("pay submits request_payment with an exact yocto amount and reports paid", async () => {
  const { client, sent } = make();
  const r = await client.pay({ to: "shop.testnet", amountNear: 0.5, memo: "invoice" });
  assert.deepEqual(r, { id: 7, status: "paid", reason: null });
  const call = sent[0].actions[0];
  assert.equal(call.methodName, "request_payment");
  assert.equal(call.deposit, "0");
  assert.deepEqual(call.args, { to: "shop.testnet", amount: "500000000000000000000000", memo: "invoice" });
  assert.equal(sent[0].receiverId, "vault.o.testnet");
});
test("the request id is read from the contract's return value when present", async () => {
  const sv = Buffer.from("12").toString("base64");
  const { client } = make({ sendResult: { result: { status: { SuccessValue: sv } } } });
  assert.equal((await client.pay({ to: "a.testnet", amountNear: 1 })).id, 12);
});
test("a rejected request is reported as rejected", async () => {
  const { client } = make({ rows: [{ status: "Pending" }, { status: "Rejected" }] });
  assert.equal((await client.pay({ to: "a.testnet", amountNear: 1 })).status, "rejected");
});
test("a request nobody decides in time stays pending", async () => {
  const { client } = make({ rows: [{ status: "Pending" }] });
  const r = await client.pay({ to: "a.testnet", amountNear: 1, waitSeconds: 0 });
  assert.equal(r.status, "pending");
  assert.equal(r.id, 7);
});
test("a refusal by the vault comes back with its reason", async () => {
  const { client } = make({ sendResult: { result: { status: { Failure: "Smart contract panicked: amount exceeds the on-chain per-transaction cap" } } } });
  const r = await client.pay({ to: "a.testnet", amountNear: 5 });
  assert.equal(r.status, "refused");
  assert.match(r.reason ?? "", /per-transaction cap/);
});
test("bad amounts never reach the network", async () => {
  const { client, sent } = make();
  await assert.rejects(() => client.pay({ to: "a.testnet", amountNear: "1e-7" }));
  await assert.rejects(() => client.pay({ to: "a.testnet", amountNear: -1 }));
  assert.equal(sent.length, 0);
});
test("the tool description is ready to hand to an LLM", () => {
  assert.equal(PAY_TOOL.name, "pay");
  assert.deepEqual(PAY_TOOL.parameters.required, ["to", "amountNear"]);
});

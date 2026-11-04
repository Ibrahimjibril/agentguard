// A tiny client for YOUR agent. The agent never sends money; it asks the vault, then waits for the decision.
import { nearToYocto } from "../policy/compile.ts";

export interface AgentNear {
  actions: { functionCall(a: { methodName: string; args: unknown; gas: string; deposit: string }): unknown };
  sendTx(a: { signerId: string; privateKey: string; receiverId: string; actions: unknown[] }): Promise<unknown>;
  view(a: { contractId: string; methodName: string; args: unknown }): Promise<any>;
}
export interface PayResult {
  id: number | null;
  status: "paid" | "rejected" | "pending" | "refused";
  reason: string | null;
}
export interface AgentOptions {
  vault: string;
  agent: string;
  privateKey: string;
  near: AgentNear;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

// A ready-made tool description you can give to an LLM agent (OpenAI / Anthropic style).
export const PAY_TOOL = {
  name: "pay",
  description:
    "Ask to pay NEAR to an account. You cannot send money yourself: a guard checks the payment against the owner's rules and may block it or ask a human. Returns paid, rejected, pending or refused.",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "Destination NEAR account, for example shop.testnet" },
      amountNear: { type: "number", description: "Amount in NEAR, for example 0.5" },
      memo: { type: "string", description: "Short reason for the payment" },
    },
    required: ["to", "amountNear"],
  },
};

function successValue(r: unknown): string | null {
  const stack: unknown[] = [r];
  let steps = 0;
  while (stack.length > 0 && steps++ < 5000) {
    const o = stack.pop() as any;
    if (!o || typeof o !== "object") continue;
    if (typeof o.SuccessValue === "string" && o.SuccessValue.length > 0) return o.SuccessValue;
    for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
  }
  return null;
}

export function createAgentClient(o: AgentOptions) {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 2000;

  async function pay(p: { to: string; amountNear: number | string; memo?: string; waitSeconds?: number }): Promise<PayResult> {
    const amount = nearToYocto(p.amountNear);
    const before = await o.near.view({ contractId: o.vault, methodName: "get_config", args: {} });
    const nextId = Number(before?.total_requests ?? 0);
    const r = await o.near.sendTx({
      signerId: o.agent,
      privateKey: o.privateKey,
      receiverId: o.vault,
      actions: [o.near.actions.functionCall({
        methodName: "request_payment",
        args: { to: p.to, amount, memo: (p.memo ?? "").slice(0, 200) },
        gas: "30 Tgas",
        deposit: "0",
      })],
    });
    const text = JSON.stringify(r ?? {});
    const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
    if (panic) return { id: null, status: "refused", reason: panic[1].trim() };
    if (/"Failure"/.test(text)) return { id: null, status: "refused", reason: "The vault could not accept the request." };

    let id = nextId;
    const sv = successValue(r);
    if (sv) {
      try { const n = JSON.parse(Buffer.from(sv, "base64").toString("utf8")); if (Number.isInteger(n)) id = n; } catch { /* keep nextId */ }
    }
    const deadline = Date.now() + (p.waitSeconds ?? 30) * 1000;
    for (;;) {
      const row = await o.near.view({ contractId: o.vault, methodName: "get_request", args: { id } });
      if (row?.status === "Paid") return { id, status: "paid", reason: null };
      if (row?.status === "Rejected") return { id, status: "rejected", reason: "Rejected by the guard or the owner." };
      if (Date.now() >= deadline) return { id, status: "pending", reason: "Waiting for a decision (the owner may need to approve it)." };
      await sleep(pollMs);
    }
  }
  return { pay };
}

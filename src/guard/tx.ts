// Finds the transaction hash inside whatever envelope the RPC client returns.
export function findTx(r: unknown): string | null {
  const stack: unknown[] = [r];
  let steps = 0;
  while (stack.length > 0 && steps++ < 5000) {
    const o = stack.pop() as any;
    if (!o || typeof o !== "object") continue;
    if (typeof o.transaction?.hash === "string") return o.transaction.hash;
    if (typeof o.transaction_outcome?.id === "string") return o.transaction_outcome.id;
    for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
  }
  return null;
}

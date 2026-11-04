"use client";
import type { SetupStatus } from "../lib/api";

interface Props { setup: SetupStatus; notify: (msg: string) => void }

export function ConnectAgent({ setup, notify }: Props) {
  const vault = setup.vault ?? "";
  const agent = setup.agent ?? "";
  const keyFile = setup.agentKeyFile ?? "";
  const cli = 'node scripts/agent-pay.mjs shop.testnet 0.5 "invoice 42"';
  const code = [
    'import { createAgentClient, PAY_TOOL } from "./src/agent/client.ts";',
    "",
    `const agent = createAgentClient({ vault: "${vault}", agent: "${agent}", privateKey, near });`,
    "// Give your AI the PAY_TOOL description instead of a wallet key, then:",
    'const result = await agent.pay({ to: "shop.testnet", amountNear: 0.5, memo: "invoice 42" });',
    '// result.status is "paid", "rejected", "pending" or "refused"',
  ].join("\n");

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied");
    } catch {
      notify("Could not copy. Select the text and copy it.");
    }
  }

  return (
    <section className="card connect" aria-labelledby="connect-title">
      <h2 id="connect-title">Connect your agent</h2>
      <p className="hint">
        Your agent never gets a wallet key. It gets the vault address and a key that can only ask for a payment.
      </p>
      <dl className="facts">
        <div><dt>Vault</dt><dd>{vault}</dd></div>
        <div><dt>Agent account</dt><dd>{agent}</dd></div>
        <div><dt>Agent key file</dt><dd>{keyFile}</dd></div>
      </dl>
      <h3>Try it from the terminal</h3>
      <pre>{cli}</pre>
      <div className="actions"><button className="btn btn-ghost" onClick={() => copy(cli)}>Copy command</button></div>
      <h3>Use it in your agent</h3>
      <pre>{code}</pre>
      <div className="actions"><button className="btn btn-ghost" onClick={() => copy(code)}>Copy code</button></div>
    </section>
  );
}

// Starts the Guard (decides every payment request) AND the local API for the dashboard.
//   node --env-file=.env scripts/serve.ts
import fs from "node:fs";
import { openStore } from "../src/guard/store.ts";
import { processAll } from "../src/guard/guard.ts";
import { nearChain, readJson } from "../src/guard/chain.ts";
import { startServer } from "../src/server/api.ts";
import { vaultInfoReader } from "../src/server/vault.ts";
import { llmFromEnv } from "../src/llm/client.ts";

const port = Number(process.env.GUARD_PORT ?? 8787);
const dep = readJson("deployment.json");
const key = readJson(`.keys/${dep.guardian}.json`).privateKey;
let llm = null;
try { llm = llmFromEnv(); } catch (e: any) { console.warn("LLM not configured:", e.message); }

const deps = {
  store: openStore(process.env.GUARD_DB ?? "guard.db"),
  chain: nearChain(dep, key),
  trusted: [dep.owner],
  knownBad: fs.existsSync("data/known-bad.json") ? readJson("data/known-bad.json") : [],
  llm,
  vaultInfo: vaultInfoReader(dep),
};
await startServer(deps, port);
console.log(`AgentGuard API on http://localhost:${port}  (vault: ${dep.vault})`);

for (;;) {
  try {
    for (const o of await processAll(deps)) {
      console.log(`#${o.id} ${o.verdict.toUpperCase()} -> ${o.status}`);
    }
  } catch (e: any) { console.error("loop error:", e?.message ?? e); }
  await new Promise((r) => setTimeout(r, 5000));
}

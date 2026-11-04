// Starts the Guard (decides every payment request) and the local API for the dashboard.
// If no sandbox exists yet, the dashboard walks you through creating one.
//   node --env-file=.env scripts/serve.ts
// Optional: GUARD_DATA_DIR=<folder> keeps deployment.json, .keys and guard.db somewhere else.
import fs from "node:fs";
import path from "node:path";
import { openStore } from "../src/guard/store.ts";
import { processAll } from "../src/guard/guard.ts";
import { nearChain, readJson } from "../src/guard/chain.ts";
import { startApp } from "../src/server/app.ts";
import type { ApiDeps } from "../src/server/api.ts";
import { vaultInfoReader } from "../src/server/vault.ts";
import { llmFromEnv } from "../src/llm/client.ts";
import { createOwner, deploySandbox, getStatus } from "../src/setup/setup.ts";
import { realOps } from "../src/setup/near-ops.ts";

const port = Number(process.env.GUARD_PORT ?? 8787);
const dir = process.env.GUARD_DATA_DIR ?? ".";
fs.mkdirSync(dir, { recursive: true });
let llm = null;
try { llm = llmFromEnv(); } catch (e: any) { console.warn("LLM not configured:", e.message); }
const ops = realOps();

let guard: ApiDeps | null = null;
function loadGuard() {
  if (guard) return;
  const status = getStatus(dir);
  if (status.stage !== "deployed") return;
  const dep = readJson(path.join(dir, "deployment.json"));
  const key = readJson(path.join(dir, ".keys", `${dep.guardian}.json`)).privateKey;
  guard = {
    store: openStore(path.join(dir, "guard.db")),
    chain: nearChain(dep, key),
    trusted: [dep.owner],
    knownBad: fs.existsSync("data/known-bad.json") ? readJson("data/known-bad.json") : [],
    llm,
    vaultInfo: vaultInfoReader(dep),
  };
  console.log(`Guarding ${dep.vault}`);
}
loadGuard();

await startApp({
  setup: {
    status: () => getStatus(dir),
    createOwner: (name) => createOwner({ ops, dir }, name),
    deploy: () => deploySandbox({ ops, dir }),
  },
  getGuard: () => guard,
  onDeployed: loadGuard,
  llmConfigured: llm !== null,
}, port);
console.log(`AgentGuard API on http://localhost:${port}${guard ? "" : "  (no sandbox yet: open the dashboard to create one)"}`);

for (;;) {
  try {
    if (guard) for (const o of await processAll(guard)) console.log(`#${o.id} ${o.verdict.toUpperCase()} -> ${o.status}`);
  } catch (e: any) { console.error("loop error:", e?.message ?? e); }
  await new Promise((r) => setTimeout(r, 5000));
}

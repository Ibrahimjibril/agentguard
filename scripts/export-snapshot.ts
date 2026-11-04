// Saves the current dashboard state as a public, read-only demo snapshot.
// It contains only public chain data and the decision log (no keys, no .env).
//   node --env-file=.env scripts/export-snapshot.ts
import path from "node:path";
import fs from "node:fs";
import { openStore } from "../src/guard/store.ts";
import { buildState } from "../src/server/api.ts";
import { vaultInfoReader } from "../src/server/vault.ts";
import { readJson } from "../src/guard/chain.ts";

const DIR = process.env.GUARD_DATA_DIR ?? ".";
const dep = readJson(path.join(DIR, "deployment.json"));
const store = openStore(process.env.GUARD_DB ?? path.join(DIR, "guard.db"));
const state: any = await buildState({
  store,
  chain: null as any,
  trusted: [],
  knownBad: [],
  llm: null,
  vaultInfo: vaultInfoReader(dep),
});
state.llmConfigured = false;
state.snapshot = { capturedAt: Date.now(), network: "testnet", vault: dep.vault, repo: "https://github.com/Ibrahimjibril/agentguard" };
fs.mkdirSync("web/public", { recursive: true });
fs.writeFileSync("web/public/demo-snapshot.json", JSON.stringify(state, null, 2));
console.log(`Saved web/public/demo-snapshot.json: ${state.decisions.length} decisions, vault ${state.vault ? "read" : "NOT read"}`);
store.close();

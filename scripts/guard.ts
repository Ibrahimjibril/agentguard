// AgentGuard service CLI.
//   node scripts/guard.ts policy <policy.json>   set the active policy
//   node scripts/guard.ts once                   process pending requests now
//   node scripts/guard.ts watch                  keep processing (every 5s)
//   node scripts/guard.ts log                    show the decision log
//   node scripts/guard.ts approve <id> | reject <id>   resolve a request awaiting a human
import path from "node:path";
import fs from "node:fs";
import { openStore } from "../src/guard/store.ts";
import { processAll, humanDecide } from "../src/guard/guard.ts";
import { nearChain, readJson } from "../src/guard/chain.ts";
import { parsePolicy } from "../src/policy/policy.ts";
import { fmtNear } from "../src/policy/policy.ts";

const [cmd, arg] = process.argv.slice(2);
const DIR = process.env.GUARD_DATA_DIR ?? ".";
const store = openStore(process.env.GUARD_DB ?? path.join(DIR, "guard.db"));
const dep = readJson(path.join(DIR, "deployment.json"));
const key = readJson(path.join(DIR, ".keys", `${dep.guardian}.json`)).privateKey;
const deps = {
  store, chain: nearChain(dep, key), trusted: [dep.owner],
  knownBad: fs.existsSync("data/known-bad.json") ? readJson("data/known-bad.json") : [],
};
const show = (o: any) => console.log(`#${o.id} ${o.verdict.toUpperCase()} -> ${o.status} (risk ${o.risk.score ?? "n/a"})\n    ${o.reasons.join("\n    ")}`);

if (cmd === "policy") {
  const p = parsePolicy(readJson(arg));
  if (!p.ok) { console.error("Invalid policy:", p.errors.join("; ")); process.exit(1); }
  store.setPolicy(p.policy, arg);
  console.log("Policy activated.");
} else if (cmd === "once") {
  const out = await processAll(deps);
  if (out.length === 0) console.log("No new pending requests.");
  out.forEach(show);
} else if (cmd === "watch") {
  console.log("Guard watching", dep.vault, "(Ctrl+C to stop)");
  for (;;) {
    try { (await processAll(deps)).forEach(show); } catch (e: any) { console.error("loop error:", e?.message ?? e); }
    await new Promise((r) => setTimeout(r, 5000));
  }
} else if (cmd === "log") {
  for (const r of store.list(20)) {
    console.log(`#${r.request_id} ${fmtNear(BigInt(r.amount))} -> ${r.to}  [${r.verdict}/${r.status}]`);
    for (const x of r.reasons) console.log(`    ${x.code}: ${x.message}`);
  }
} else if (cmd === "approve" || cmd === "reject") {
  console.log("Result:", await humanDecide(deps, Number(arg), cmd === "approve"));
} else {
  console.log("Usage: policy <file> | once | watch | log | approve <id> | reject <id>");
}
store.close();

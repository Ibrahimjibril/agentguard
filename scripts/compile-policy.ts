// Usage: npm run compile -- "No more than 5 NEAR per payment, 20 NEAR per day"
import { compilePolicy } from "../src/policy/compile.ts";
import { llmFromEnv } from "../src/llm/client.ts";

const text = process.argv.slice(2).join(" ");
if (!text) {
  console.error('Usage: npm run compile -- "your rules in plain language"');
  process.exit(1);
}
const result = await compilePolicy(text, llmFromEnv());
if (!result.ok) {
  console.error("Could not compile a valid policy:", result.errors.join("; "));
  process.exit(2);
}
console.log(`Compiled in ${result.attempts} attempt(s). REVIEW before activating:\n`);
for (const line of result.summary) console.log(" -", line);
for (const w of result.warnings) console.log(" ! WARNING:", w);
console.log("\nPolicy JSON:\n" + JSON.stringify(result.policy, null, 2));

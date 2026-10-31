import { test } from "node:test";
import assert from "node:assert/strict";
import { llmFromEnv } from "./client.ts";

const env = { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_BASE_URL: "https://x.test/v1/", LLM_MODEL: "m1,m2" };
const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const bad = (status: number, msg = "boom") => new Response(JSON.stringify([{ error: { code: status, message: msg } }]), { status });
const noSleep = async () => {};

test("retries a 503 on the same model and then succeeds", async () => {
  const seen: string[] = [];
  let n = 0;
  const fetchFn = (async (_u: any, init: any) => {
    seen.push(JSON.parse(init.body).model);
    return ++n === 1 ? bad(503, "high demand") : ok("hello");
  }) as any;
  const llm = llmFromEnv(env, { fetchFn, sleep: noSleep });
  assert.equal(await llm("s", "u"), "hello");
  assert.deepEqual(seen, ["m1", "m1"]);
});
test("falls back to the next model on 404", async () => {
  const seen: string[] = [];
  const fetchFn = (async (_u: any, init: any) => {
    const m = JSON.parse(init.body).model;
    seen.push(m);
    return m === "m1" ? bad(404, "model not found") : ok("from m2");
  }) as any;
  const llm = llmFromEnv(env, { fetchFn, sleep: noSleep });
  assert.equal(await llm("s", "u"), "from m2");
  assert.deepEqual(seen, ["m1", "m2"]);
});
test("falls back after repeated 503 on the first model", async () => {
  const seen: string[] = [];
  const fetchFn = (async (_u: any, init: any) => {
    const m = JSON.parse(init.body).model;
    seen.push(m);
    return m === "m1" ? bad(503) : ok("m2 ok");
  }) as any;
  const llm = llmFromEnv(env, { fetchFn, sleep: noSleep });
  assert.equal(await llm("s", "u"), "m2 ok");
  assert.deepEqual(seen, ["m1", "m1", "m1", "m2"]);
});
test("bad key stops immediately with a clear message", async () => {
  let calls = 0;
  const fetchFn = (async () => { calls++; return bad(403, "denied"); }) as any;
  const llm = llmFromEnv(env, { fetchFn, sleep: noSleep });
  await assert.rejects(() => llm("s", "u"), /rejected the API key/);
  assert.equal(calls, 1);
});
test("total failure reports the real reasons, not 'unknown'", async () => {
  const fetchFn = (async () => bad(503, "Spikes in demand")) as any;
  const llm = llmFromEnv(env, { fetchFn, sleep: noSleep });
  await assert.rejects(() => llm("s", "u"), /HTTP 503 Spikes in demand/);
});
test("missing key or config fails fast", () => {
  assert.throws(() => llmFromEnv({ LLM_PROVIDER: "openai" }), /LLM_API_KEY/);
  assert.throws(() => llmFromEnv({ LLM_PROVIDER: "openai", LLM_API_KEY: "k" }), /LLM_BASE_URL/);
});

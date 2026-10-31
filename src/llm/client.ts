// Minimal LLM client (no SDK). Providers: "anthropic" (default) or "openai"
// (any OpenAI-compatible chat/completions endpoint). Configure via .env.
// LLM_MODEL may be a comma-separated list: if a model is overloaded (503/429)
// we retry with backoff, then fall back to the next model in the list.
import type { LlmFn } from "../policy/compile.ts";

export interface ClientOpts {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function errMsg(j: any): string {
  const e = Array.isArray(j) ? j[0]?.error : j?.error;
  return String(e?.message ?? JSON.stringify(j)).slice(0, 200);
}

async function callWithFallback(
  models: string[],
  once: (model: string) => Promise<Response>,
  o: ClientOpts,
  maxTries = 3,
): Promise<any> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const problems: string[] = [];
  for (const model of models) {
    for (let t = 1; t <= maxTries; t++) {
      let res: Response;
      try {
        res = await once(model);
      } catch (e) {
        problems.push(`${model}: ${(e as Error).message}`);
        if (t < maxTries) { await sleep(1000 * t); continue; }
        break;
      }
      const text = await res.text();
      let j: any;
      try { j = JSON.parse(text); } catch { j = text; }
      if (res.ok) return j;
      problems.push(`${model}: HTTP ${res.status} ${errMsg(j)}`);
      if (res.status === 401 || res.status === 403) {
        throw new Error(`LLM rejected the API key (HTTP ${res.status}). Check LLM_API_KEY.`);
      }
      if (RETRYABLE.has(res.status) && t < maxTries) { await sleep(1000 * 2 ** (t - 1)); continue; }
      break; // not retryable (e.g. 404 unknown model) -> next model
    }
  }
  throw new Error(`LLM request failed. ${problems.slice(-4).join(" | ")}`);
}

export function llmFromEnv(
  env: Record<string, string | undefined> = process.env,
  o: ClientOpts = {},
): LlmFn {
  const provider = env.LLM_PROVIDER ?? "anthropic";
  const key = env.LLM_API_KEY;
  if (!key) throw new Error("LLM_API_KEY is missing. Copy .env.example to .env and fill it in.");
  const f = o.fetchFn ?? fetch;
  const list = (v: string | undefined, d?: string) =>
    (v ?? d ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (provider === "anthropic") {
    const models = list(env.LLM_MODEL, "claude-haiku-5-5");
    return async (system, user) => {
      const j = await callWithFallback(models, (model) =>
        f("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: 1000, system, messages: [{ role: "user", content: user }] }),
          signal: AbortSignal.timeout(45000),
        }), o);
      return (j.content ?? []).map((b: any) => (b.type === "text" ? b.text : "")).join("");
    };
  }

  if (provider === "openai") {
    const base = env.LLM_BASE_URL;
    const models = list(env.LLM_MODEL);
    if (!base || models.length === 0) throw new Error("For LLM_PROVIDER=openai, set LLM_BASE_URL and LLM_MODEL.");
    return async (system, user) => {
      const j = await callWithFallback(models, (model) =>
        f(`${base.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
          signal: AbortSignal.timeout(45000),
        }), o);
      return j.choices?.[0]?.message?.content ?? "";
    };
  }
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}

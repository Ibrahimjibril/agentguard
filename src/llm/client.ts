// Minimal LLM client (no SDK). Providers: "anthropic" (default) or "openai"
// (any OpenAI-compatible chat/completions endpoint). Configure via .env.
import type { LlmFn } from "../policy/compile.ts";

export function llmFromEnv(env: Record<string, string | undefined> = process.env): LlmFn {
  const provider = env.LLM_PROVIDER ?? "anthropic";
  const key = env.LLM_API_KEY;
  if (!key) throw new Error("LLM_API_KEY is missing. Copy .env.example to .env and fill it in.");

  if (provider === "anthropic") {
    const model = env.LLM_MODEL ?? "claude-haiku-5-5";
    return async (system, user) => {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1000, system, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(30000),
      });
      const j: any = await res.json();
      if (!res.ok) throw new Error(`LLM error ${res.status}: ${j?.error?.message ?? "unknown"}`);
      return (j.content ?? []).map((b: any) => (b.type === "text" ? b.text : "")).join("");
    };
  }

  if (provider === "openai") {
    const base = env.LLM_BASE_URL;
    const model = env.LLM_MODEL;
    if (!base || !model) throw new Error("For LLM_PROVIDER=openai, set LLM_BASE_URL and LLM_MODEL.");
    return async (system, user) => {
      const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(30000),
      });
      const j: any = await res.json();
      if (!res.ok) throw new Error(`LLM error ${res.status}: ${j?.error?.message ?? "unknown"}`);
      return j.choices?.[0]?.message?.content ?? "";
    };
  }
  throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
}

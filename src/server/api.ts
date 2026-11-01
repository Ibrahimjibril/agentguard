// Local HTTP API for the dashboard. Binds to 127.0.0.1 only (see scripts/serve.ts).
// Safety: Host must be localhost (blocks DNS rebinding) and any browser POST must
// come from an allowed Origin (blocks other websites from approving payments).
import http from "node:http";
import { parsePolicy, fmtNear } from "../policy/policy.ts";
import { compilePolicy, describePolicy, policyWarnings } from "../policy/compile.ts";
import type { LlmFn } from "../policy/compile.ts";
import { humanDecide, processAll } from "../guard/guard.ts";
import type { Deps } from "../guard/guard.ts";

export interface ApiDeps extends Deps {
  llm: LlmFn | null;
  vaultInfo: () => Promise<unknown>;
  allowedOrigins?: string[];
}

const MAX_BODY = 64 * 1024;
const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8787", "http://127.0.0.1:8787"];

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "request body too large");
    chunks.push(c as Buffer);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "body must be valid JSON"); }
}

export async function buildState(d: ApiDeps) {
  const policy = d.store.getPolicy();
  const decisions = d.store.list(50).map((r) => ({
    id: r.request_id, to: r.to, amount: r.amount, amountNear: fmtNear(BigInt(r.amount)), memo: r.memo,
    verdict: r.verdict, status: r.status, reasons: r.reasons, risk: r.risk, tx: r.tx, ts: r.ts, updated: r.updated,
  }));
  const vault = await d.vaultInfo().catch(() => null);
  return {
    policy: policy ? { json: policy, summary: describePolicy(policy), warnings: policyWarnings(policy) } : null,
    decisions,
    awaiting: decisions.filter((x) => x.status === "awaiting_approval").length,
    vault,
    llmConfigured: d.llm !== null,
  };
}

export function createHandler(d: ApiDeps) {
  const origins = d.allowedOrigins ?? DEFAULT_ORIGINS;
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = req.headers.origin;
    const send = (status: number, body: unknown) => {
      const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
      if (origin && origins.includes(origin)) {
        headers["access-control-allow-origin"] = origin;
        headers["access-control-allow-headers"] = "content-type";
        headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
        headers["vary"] = "Origin";
      }
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    try {
      const host = String(req.headers.host ?? "");
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw new HttpError(403, "bad host");
      if (origin && !origins.includes(origin)) throw new HttpError(403, "origin not allowed");
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (req.method === "OPTIONS") return send(204, {});

      if (req.method === "GET" && path === "/api/health") return send(200, { ok: true });

      if (req.method === "GET" && path === "/api/state") return send(200, await buildState(d));

      if (req.method === "POST" && path === "/api/policy/compile") {
        if (!d.llm) throw new HttpError(503, "LLM is not configured (see .env.example)");
        const body = await readJson(req);
        const r = await compilePolicy(String(body.text ?? ""), d.llm);
        return r.ok
          ? send(200, { ok: true, policy: r.policy, summary: r.summary, warnings: r.warnings, attempts: r.attempts })
          : send(422, { ok: false, errors: r.errors });
      }

      if (req.method === "POST" && path === "/api/policy/activate") {
        const body = await readJson(req);
        const p = parsePolicy(body.policy);
        if (!p.ok) return send(422, { ok: false, errors: p.errors });
        const warnings = policyWarnings(p.policy);
        if (warnings.length > 0 && body.confirmUnlimited !== true) {
          return send(409, { ok: false, needsConfirmation: true, warnings });
        }
        d.store.setPolicy(p.policy, "dashboard", d.now?.() ?? Date.now());
        return send(200, { ok: true, summary: describePolicy(p.policy), warnings });
      }

      const m = path.match(/^\/api\/decisions\/(\d+)\/(approve|reject)$/);
      if (req.method === "POST" && m) {
        try {
          const status = await humanDecide(d, Number(m[1]), m[2] === "approve");
          return send(200, { ok: true, status });
        } catch (e: any) { throw new HttpError(409, String(e?.message ?? e)); }
      }

      if (req.method === "POST" && path === "/api/process") {
        const out = await processAll(d);
        return send(200, { ok: true, processed: out.length });
      }

      throw new HttpError(404, "not found");
    } catch (e: any) {
      if (e instanceof HttpError) return send(e.status, { ok: false, error: e.message });
      console.error("api error:", e?.message ?? e);
      return send(500, { ok: false, error: "internal error" });
    }
  };
}

export function startServer(d: ApiDeps, port = 8787): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(createHandler(d));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

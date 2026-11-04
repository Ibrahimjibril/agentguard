// The server entry: setup routes (create your sandbox) plus the Guard routes once a sandbox exists.
import http from "node:http";
import { assertAllowed, createHandler, DEFAULT_ORIGINS, HttpError, readJson, respond } from "./api.ts";
import type { ApiDeps } from "./api.ts";
import type { SetupStatus } from "../setup/setup.ts";
import { SetupError } from "../setup/setup.ts";

export interface AppDeps {
  setup: {
    status(): SetupStatus;
    createOwner(name: unknown): Promise<string>;
    deploy(): Promise<unknown>;
  };
  getGuard: () => ApiDeps | null;
  onDeployed: () => void | Promise<void>;
  llmConfigured: boolean;
  allowedOrigins?: string[];
}

export function createApp(a: AppDeps) {
  const origins = a.allowedOrigins ?? DEFAULT_ORIGINS;
  let cached: { guard: ApiDeps; handler: ReturnType<typeof createHandler> } | null = null;
  let busy = false;

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = req.headers.origin;
    const send = (status: number, body: unknown) => respond(res, origin, origins, status, body);
    try {
      assertAllowed(req, origins);
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "OPTIONS") return send(204, {});

      if (req.method === "GET" && path === "/api/setup") {
        return send(200, { ok: true, ...a.setup.status(), llmConfigured: a.llmConfigured });
      }
      if (req.method === "POST" && (path === "/api/setup/owner" || path === "/api/setup/deploy")) {
        if (busy) throw new HttpError(409, "Setup is already running. Wait for it to finish.");
        busy = true;
        try {
          if (path === "/api/setup/owner") {
            const body = await readJson(req);
            const owner = await a.setup.createOwner(body.name);
            return send(200, { ok: true, owner });
          }
          await a.setup.deploy();
          await a.onDeployed();
          return send(200, { ok: true, ...a.setup.status() });
        } finally {
          busy = false;
        }
      }

      if (path === "/api/health") return send(200, { ok: true });
      const guard = a.getGuard();
      if (!guard) throw new HttpError(409, "No sandbox yet. Create one first.");
      if (!cached || cached.guard !== guard) cached = { guard, handler: createHandler(guard) };
      return cached.handler(req, res);
    } catch (e: any) {
      if (e instanceof HttpError || e instanceof SetupError) return send(e.status, { ok: false, error: e.message });
      console.error("app error:", e?.message ?? e);
      return send(500, { ok: false, error: "internal error" });
    }
  };
}

export function startApp(a: AppDeps, port = 8787): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(createApp(a));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

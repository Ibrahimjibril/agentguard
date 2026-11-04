import { runCheck } from "../../../lib/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 20;
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) return Response.json({ ok: false, error: "Too many tries. Wait a minute." }, { status: 429 });
  let body: unknown = {};
  try { body = await req.json(); } catch { /* empty */ }
  const r = await runCheck(body);
  return Response.json(r.json, { status: r.status });
}

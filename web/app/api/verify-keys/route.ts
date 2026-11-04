import { accessKeys, VAULT, AGENT } from "../../../lib/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [vault, agent] = await Promise.all([accessKeys(VAULT), accessKeys(AGENT)]);
  return Response.json({ network: "testnet", accounts: [
    { account: VAULT, keys: vault },
    { account: AGENT, keys: agent },
  ] });
}

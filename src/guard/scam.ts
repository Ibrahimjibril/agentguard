// Pre-transaction scam heuristics for a destination account.
// Pure function: the chain facts are fetched elsewhere and passed in.
// score = null means "could not check" -> the policy engine asks a human.
export interface Facts { exists: boolean | null }
export interface Risk { score: number | null; reasons: string[] }

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const PHISH = /(airdrop|giveaway|claim|bonus|support|verify|admin|reward)/;

export function scoreDestination(
  to: string,
  facts: Facts,
  ctx: { trusted: string[]; knownBad: string[] },
): Risk {
  if (ctx.knownBad.includes(to)) return { score: 100, reasons: ["Destination is on the known-bad list."] };
  if (ctx.trusted.includes(to)) return { score: 0, reasons: ["Destination is a trusted account."] };
  if (facts.exists === null) {
    return { score: null, reasons: ["Could not verify the destination on chain; scam check unavailable."] };
  }
  const reasons: string[] = [];
  let score = 0;
  const implicit = /^[0-9a-f]{64}$/.test(to);
  if (facts.exists === false) {
    if (implicit) { score += 25; reasons.push("Implicit account has never received funds (brand-new account)."); }
    else { score += 70; reasons.push("Named account does not exist on chain (typo or throwaway address)."); }
  }
  for (const t of ctx.trusted) {
    const d = levenshtein(to, t);
    if (d > 0 && d <= 2 && Math.max(to.length, t.length) >= 5) {
      score += 60;
      reasons.push(`Looks like trusted account ${t} (differs by ${d} character${d > 1 ? "s" : ""}).`);
      break;
    }
  }
  if (PHISH.test(to)) { score += 20; reasons.push("Name contains a phishing-style keyword."); }
  if (reasons.length === 0) reasons.push("No risk signals found.");
  return { score: Math.min(100, score), reasons };
}

import { ImageResponse } from "next/og";
import { INK, MARK_DATA_URI, PAPER } from "../lib/brand";

export const alt = "AgentGuard: let your AI agent spend, safely";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The picture shown when the link is shared on X, Telegram, WhatsApp, Slack and so on.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: INK,
          color: PAPER,
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <img src={MARK_DATA_URI} width={92} height={92} />
          <div style={{ display: "flex", marginLeft: 24, fontSize: 54, fontWeight: 700 }}>AgentGuard</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 78, fontWeight: 700, lineHeight: 1.05 }}>
            Your agent can ask. The gate decides.
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 30, color: "#AEB8C7" }}>
            Safe spending for AI agents on NEAR: your rules, a scam check, and on-chain limits.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

import { ImageResponse } from "next/og";
import { INK, MARK_DATA_URI } from "../lib/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: INK }}>
        <img src={MARK_DATA_URI} width={120} height={120} />
      </div>
    ),
    { ...size },
  );
}

// The AgentGuard mark as data URIs, for generated images (social preview, app icon).
const mark = (stroke: string, dot: string) =>
  `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      `<path d="M37.02 13.07A17 17 0 1 0 41 24H25" stroke="${stroke}" stroke-width="6"/>` +
      `<circle cx="25" cy="24" r="4" fill="${dot}"/></svg>`,
  )}`;

export const INK = "#2A2118";
export const PAPER = "#F2EAD3";
export const MARK_ON_LIGHT = mark("#2A2118", "#C9391C");
export const MARK_ON_DARK = mark("#F2EAD3", "#E8643F");

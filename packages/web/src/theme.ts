// Theming for the embedded Skill Studio. Colors are driven by **CSS custom
// properties** on the shadow host so a host page can brand the element without
// touching its internals, e.g.
//
//   baobox-skill-builder { --bb-accent: #e11d48; --bb-radius: 12px; }
//
// Every value the UI uses is `var(--bb-…, <fallback>)`: inside the shadow root
// the stylesheet below defines the defaults (and the `theme="dark"` overrides),
// and a host's own rule wins over both. The fallbacks also keep the component
// rendering correctly when it is used directly (no shadow root) — e.g. in tests
// or a plain Preact/React tree.

export type ThemeName = "light" | "dark";

export interface Palette {
  font: string;
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  accentFg: string;
  card: string;
  danger: string;
  success: string;
  radius: string;
}

// Concrete fallbacks per theme — used only when the custom properties aren't
// defined (i.e. outside a shadow root). Inside the shadow root THEME_STYLE wins.
const FALLBACK: Record<ThemeName, Omit<Palette, "font" | "radius">> = {
  light: {
    bg: "#ffffff",
    fg: "#0f172a",
    muted: "#64748b",
    border: "#e2e8f0",
    accent: "#4f46e5",
    accentFg: "#ffffff",
    card: "#f8fafc",
    danger: "#b91c1c",
    success: "#15803d",
  },
  dark: {
    bg: "#0f172a",
    fg: "#e2e8f0",
    muted: "#94a3b8",
    border: "#1e293b",
    accent: "#818cf8",
    accentFg: "#0b1020",
    card: "#1e293b",
    danger: "#f87171",
    success: "#4ade80",
  },
};

/** Build the palette of `var(--bb-…, fallback)` strings the UI styles use. */
export function resolvePalette(theme: ThemeName): Palette {
  const f = FALLBACK[theme] ?? FALLBACK.light;
  return {
    font: "var(--bb-font, ui-sans-serif, system-ui, sans-serif)",
    bg: `var(--bb-bg, ${f.bg})`,
    fg: `var(--bb-fg, ${f.fg})`,
    muted: `var(--bb-muted, ${f.muted})`,
    border: `var(--bb-border, ${f.border})`,
    accent: `var(--bb-accent, ${f.accent})`,
    accentFg: `var(--bb-accent-fg, ${f.accentFg})`,
    card: `var(--bb-card, ${f.card})`,
    danger: `var(--bb-danger, ${f.danger})`,
    success: `var(--bb-success, ${f.success})`,
    radius: "var(--bb-radius, 8px)",
  };
}

/**
 * The stylesheet injected into the shadow root. It defines the brandable custom
 * properties (light defaults + a `theme="dark"` override on the host). A host
 * page overrides any of these from its own CSS to theme the element.
 */
export const THEME_STYLE = `
:host {
  --bb-font: ui-sans-serif, system-ui, sans-serif;
  --bb-bg: ${FALLBACK.light.bg};
  --bb-fg: ${FALLBACK.light.fg};
  --bb-muted: ${FALLBACK.light.muted};
  --bb-border: ${FALLBACK.light.border};
  --bb-accent: ${FALLBACK.light.accent};
  --bb-accent-fg: ${FALLBACK.light.accentFg};
  --bb-card: ${FALLBACK.light.card};
  --bb-danger: ${FALLBACK.light.danger};
  --bb-success: ${FALLBACK.light.success};
  --bb-radius: 8px;
  display: block;
}
:host([theme="dark"]) {
  --bb-bg: ${FALLBACK.dark.bg};
  --bb-fg: ${FALLBACK.dark.fg};
  --bb-muted: ${FALLBACK.dark.muted};
  --bb-border: ${FALLBACK.dark.border};
  --bb-accent: ${FALLBACK.dark.accent};
  --bb-accent-fg: ${FALLBACK.dark.accentFg};
  --bb-card: ${FALLBACK.dark.card};
  --bb-danger: ${FALLBACK.dark.danger};
  --bb-success: ${FALLBACK.dark.success};
}
`;

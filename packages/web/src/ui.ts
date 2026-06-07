import type { JSX } from "preact";
import { SkillStudioApiError } from "./api.js";
import type { Palette } from "./theme.js";

// Small shared style helpers + error formatting, so every view renders the same
// buttons/inputs/cards from the themed palette (all colors are CSS custom
// properties via `resolvePalette`).

type CSS = JSX.CSSProperties;

export function msgOf(err: unknown): string {
  if (err instanceof SkillStudioApiError) return `${err.message} (${err.code})`;
  return err instanceof Error ? err.message : "Something went wrong";
}

/** Pull the stable contract error code off a thrown API error, if present. */
export function codeOf(err: unknown): string | null {
  return err instanceof SkillStudioApiError ? err.code : null;
}

export function linkBtn(p: Palette): CSS {
  return { background: "none", border: "none", color: p.accent, cursor: "pointer", padding: 0, font: "inherit" };
}

export function primaryBtn(p: Palette, disabled = false): CSS {
  return {
    background: disabled ? p.muted : p.accent,
    color: p.accentFg,
    border: "none",
    borderRadius: "6px",
    padding: "0.45rem 0.9rem",
    cursor: disabled ? "default" : "pointer",
    font: "inherit",
  };
}

export function ghostBtn(p: Palette): CSS {
  return {
    background: p.bg,
    color: p.fg,
    border: `1px solid ${p.border}`,
    borderRadius: "6px",
    padding: "0.4rem 0.75rem",
    cursor: "pointer",
    font: "inherit",
  };
}

export function inputStyle(p: Palette): CSS {
  return {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: "6px",
    border: `1px solid ${p.border}`,
    padding: "0.5rem",
    background: p.bg,
    color: p.fg,
    fontFamily: "inherit",
    fontSize: "0.9rem",
  };
}

export function cardStyle(p: Palette): CSS {
  return {
    background: p.card,
    border: `1px solid ${p.border}`,
    borderRadius: "6px",
    padding: "0.6rem 0.75rem",
  };
}

export function labelStyle(): CSS {
  return { display: "block", fontSize: "0.85rem", fontWeight: 600, margin: "0.5rem 0 0.25rem" };
}

export function sectionTitle(): CSS {
  return { fontSize: "0.95rem", fontWeight: 600, margin: "1.25rem 0 0.5rem" };
}

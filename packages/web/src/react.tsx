import * as React from "react";
import { DEFAULT_TAG, registerSkillBuilder } from "./element.js";

// Importing the React wrapper registers the element as a side effect, so a
// React host can drop <SkillBuilder/> in without a separate bootstrap step.
registerSkillBuilder();

export interface SkillBuilderProps {
  /** Base URL of the tenant BFF. Required. */
  apiBase: string;
  /** Visual theme. Default "light". */
  theme?: "light" | "dark";
  /** Optional className on the host element. */
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Thin typed React wrapper around `<baobox-skill-builder>`. `apiBase`/`theme`
 * are strings, so React sets them as the element's attributes — no ref plumbing
 * needed. The underlying element does all data access against `apiBase`.
 */
export function SkillBuilder({ apiBase, theme, className, style }: SkillBuilderProps): React.ReactElement {
  return React.createElement(DEFAULT_TAG, {
    "api-base": apiBase,
    ...(theme ? { theme } : {}),
    ...(className ? { className } : {}),
    ...(style ? { style } : {}),
  });
}

// ---------------------------------------------------------------------------
// Static model catalog for the Skill Studio model picker (#302).
//
// Decision: Skill Studio uses a STATIC catalog rather than calling the BaoBox
// backend's `/tenant-session/llm-providers` or `/llm-integrations/:id/models`
// endpoint. Reasons:
//   1. The BFF surface is the tenant's own BFF (not BaoBox directly), and the
//      BFF currently exposes only the `skills.*` surface (#246 contract).
//   2. Adding a live-catalog endpoint would require BFF changes (out of scope
//      for #302) and a BaoBox admin-secret call from the browser's BFF.
//   3. The catalog is small and changes infrequently; a static list is the
//      right trade-off for a walking skeleton. A future ticket can replace this
//      with a catalog endpoint once the BFF surface is widened.
//
// The `family` field drives the parameter panel:
//   - "reasoning" → show `reasoningEffort` selector, hide temperature/maxTokens
//   - "sampling"  → show temperature + maxTokens, hide reasoningEffort
//
// Per-model reasoning effort sets (OpenAI docs):
//   - gpt-5 / gpt-5-mini / gpt-5-nano: ["minimal","low","medium","high"]
//   - gpt-5.4 / gpt-5.5: ["none","low","medium","high","xhigh"]  (no "minimal")
//   - o-series uses the same set as gpt-5 family by default
//   - sampling models: no reasoning effort
// ---------------------------------------------------------------------------

import type { ReasoningEffort } from "@baobox/skill-builder-contract";

export type ModelFamily = "reasoning" | "sampling";

export interface CatalogModel {
  /** The model string stored on the Skill (wire value). */
  id: string;
  /** Human-readable label shown in the picker. */
  label: string;
  family: ModelFamily;
  /**
   * The valid reasoning-effort values for this model (reasoning family only).
   * Absent / undefined for sampling models.
   */
  reasoningEfforts?: ReasoningEffort[];
}

export interface CatalogProvider {
  /** Provider slug (used as group header). */
  id: string;
  /** Human-readable provider name. */
  label: string;
  models: CatalogModel[];
}

/** Effort set for gpt-5 / gpt-5-mini / gpt-5-nano and o-series. */
const GPT5_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];

/** Effort set for gpt-5.4 / gpt-5.5 (drops "minimal", adds "none" + "xhigh"). */
const GPT54_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];

export const MODEL_CATALOG: CatalogProvider[] = [
  {
    id: "minimax",
    label: "MiniMax",
    models: [
      { id: "MiniMax-M2.7", label: "MiniMax M2.7", family: "sampling" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-5", label: "GPT-5", family: "reasoning", reasoningEfforts: GPT5_EFFORTS },
      { id: "gpt-5-mini", label: "GPT-5 mini", family: "reasoning", reasoningEfforts: GPT5_EFFORTS },
      { id: "gpt-5-nano", label: "GPT-5 nano", family: "reasoning", reasoningEfforts: GPT5_EFFORTS },
      { id: "gpt-5.4", label: "GPT-5.4", family: "reasoning", reasoningEfforts: GPT54_EFFORTS },
      { id: "gpt-5.5", label: "GPT-5.5", family: "reasoning", reasoningEfforts: GPT54_EFFORTS },
      { id: "o3", label: "o3", family: "reasoning", reasoningEfforts: GPT5_EFFORTS },
      { id: "o3-mini", label: "o3-mini", family: "reasoning", reasoningEfforts: GPT5_EFFORTS },
      { id: "o4-mini", label: "o4-mini", family: "reasoning", reasoningEfforts: GPT5_EFFORTS },
      { id: "gpt-4o", label: "GPT-4o", family: "sampling" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", family: "sampling" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      { id: "claude-opus-4-5", label: "Claude Opus 4.5", family: "sampling" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", family: "sampling" },
      { id: "claude-haiku-3-5", label: "Claude Haiku 3.5", family: "sampling" },
    ],
  },
];

/** Flat list of all catalog model ids (for quick lookup). */
export const CATALOG_MODEL_IDS = new Set<string>(
  MODEL_CATALOG.flatMap((p) => p.models.map((m) => m.id)),
);

/** Look up a model's family. Returns undefined when the model is not in the catalog (free-text entry). */
export function getModelFamily(modelId: string): ModelFamily | undefined {
  for (const provider of MODEL_CATALOG) {
    const found = provider.models.find((m) => m.id === modelId);
    if (found) return found.family;
  }
  return undefined;
}

/**
 * Return the valid reasoning-effort values for a given model id.
 *
 * - Known reasoning model → the model's specific effort set (never the full 6-value set).
 * - Known sampling model → undefined (no effort selector shown).
 * - Unknown / free-text model → the full REASONING_EFFORT_VALUES set (best-effort fallback).
 */
export function getReasoningEfforts(modelId: string): ReasoningEffort[] | undefined {
  for (const provider of MODEL_CATALOG) {
    const found = provider.models.find((m) => m.id === modelId);
    if (!found) continue;
    if (found.family === "sampling") return undefined;
    // Reasoning model: return its specific set (or full set if somehow absent).
    return found.reasoningEfforts ?? (["minimal", "low", "medium", "high"] as ReasoningEffort[]);
  }
  // Free-text / unknown: return the full contract set so nothing is hidden.
  return ["none", "minimal", "low", "medium", "high", "xhigh"] as ReasoningEffort[];
}

/** Flat list of `"Provider / Label"` strings for datalist option labels. */
export function catalogOptionLabels(): string[] {
  return MODEL_CATALOG.flatMap((p) => p.models.map((m) => `${p.label} / ${m.label} (${m.id})`));
}

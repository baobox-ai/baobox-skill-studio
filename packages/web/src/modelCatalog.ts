// ---------------------------------------------------------------------------
// Model catalog for the Skill Studio model picker (#302 / #320).
//
// #320: The PREFERRED source is the live catalog fetched from the BFF via
// `GET /models` (`listModels` action). The BFF calls `client.catalog.list()`
// on the SDK (ADMIN_SECRET-gated). Use `fetchModelCatalog(api)` to load it
// at runtime and pass the result to `getModelFamily` / `getReasoningEfforts`.
//
// The STATIC `MODEL_CATALOG` below is the OFFLINE / DEV FALLBACK — used when
// the live fetch fails (e.g. the BFF uses an apiKey without adminSecret) or
// has not yet resolved. It is clearly marked and must not be used as the
// primary source once the live catalog is available.
// live catalog comes from the BFF `listModels` action (#320).
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

import type { ModelCatalogResponse } from "./api.js";
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

/**
 * OFFLINE / DEV FALLBACK — used when the live BFF catalog fetch fails or
 * has not yet resolved. The live catalog comes from the BFF `listModels`
 * action (#320). Prefer `fetchModelCatalog(api)` in production.
 */
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

/**
 * Project a live `ModelCatalogResponse` (from the BFF `listModels` action)
 * into the local `CatalogProvider[]` shape used by the picker helpers.
 * The live catalog uses `paramProfile: "sampling" | "reasoning"` — same
 * vocabulary as the local `ModelFamily` type.
 */
function liveToLocal(live: ModelCatalogResponse): CatalogProvider[] {
  return live.providers.map((p: ModelCatalogResponse["providers"][number]) => ({
    id: p.id,
    label: p.displayName,
    models: p.models.map((m: ModelCatalogResponse["providers"][number]["models"][number]) => ({
      id: m.id,
      label: m.displayName,
      family: m.paramProfile as ModelFamily,
      reasoningEfforts: m.reasoningEfforts as ReasoningEffort[] | undefined,
    })),
  }));
}

/**
 * Fetch the live LLM model catalog from the BFF (`GET /models`, #320).
 * Returns the projected `CatalogProvider[]` on success, or `null` when the
 * BFF returns an error (e.g. apiKey-only BFF that lacks adminSecret access).
 * The caller should fall back to `MODEL_CATALOG` when this returns null.
 */
export async function fetchModelCatalog(
  api: { listModels(): Promise<ModelCatalogResponse> },
): Promise<CatalogProvider[] | null> {
  try {
    const live = await api.listModels();
    const projected = liveToLocal(live);
    return projected.length > 0 ? projected : null;
  } catch {
    return null;
  }
}

/** Look up a model's family. Returns undefined when the model is not in the catalog (free-text entry). */
export function getModelFamily(
  modelId: string,
  catalog: CatalogProvider[] = MODEL_CATALOG,
): ModelFamily | undefined {
  for (const provider of catalog) {
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
export function getReasoningEfforts(
  modelId: string,
  catalog: CatalogProvider[] = MODEL_CATALOG,
): ReasoningEffort[] | undefined {
  for (const provider of catalog) {
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
export function catalogOptionLabels(catalog: CatalogProvider[] = MODEL_CATALOG): string[] {
  return catalog.flatMap((p) => p.models.map((m) => `${p.label} / ${m.label} (${m.id})`));
}

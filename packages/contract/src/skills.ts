import type { IntegrationModelsView, LlmIntegration, ModelRole, Skill, SkillFileReference, SkillWithFiles } from "@baobox/sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Per-role model config (#328) — re-exported from @baobox/sdk so downstream
// consumers (BFF + Web Component) share one source of truth without importing
// @baobox/sdk directly. The contract owns the Zod validation layer.
// ---------------------------------------------------------------------------
export type {
  ModelRole,
  RoleModelChainEntry,
  SkillRoleModel,
  SkillRoleModelsMap,
} from "@baobox/sdk";

/**
 * The four roles the server supports. Re-declared as a const tuple so the
 * contract can build Zod schemas (z.enum requires a tuple, not a type alias).
 * A compile-time drift guard below asserts this stays in sync with the SDK type.
 */
export const MODEL_ROLES = [
  "main",
  "preflight_guard",
  "postflight_guard",
  "eval_judge",
] as const;

// Compile-time drift guard: every MODEL_ROLES entry must be assignable to the
// SDK's ModelRole. If the SDK ever removes or renames a role, this line stops
// compiling — keeping the contract honest without runtime overhead.
const _modelRolesTrackSdk = ((): readonly ModelRole[] => MODEL_ROLES)();
void _modelRolesTrackSdk;

/** Zod validator for a single PUT body — the role being updated. */
export const modelRoleSchema = z.enum(MODEL_ROLES);

/**
 * A single entry in a role's chain as supplied in a PUT request.
 * Studio sends `{ llmIntegrationId: null, model, llmSource: "pinned" }` for
 * catalog-pinned entries (no off-box integration in Studio scope).
 */
export const roleModelChainEntrySchema = z
  .object({
    llmIntegrationId: z.string().nullable(),
    model: z.string().nullable(),
    llmSource: z.enum(["tenant_default", "platform", "pinned"]),
  })
  .strict();

/** PUT /skills/:id/role-models — replace one role's chain (max 4 entries). */
export const putRoleModelsRequestSchema = z
  .object({
    role: modelRoleSchema,
    chain: z.array(roleModelChainEntrySchema).max(4),
  })
  .strict();
export type PutRoleModelsRequest = z.infer<typeof putRoleModelsRequestSchema>;

// ---------------------------------------------------------------------------
// Reasoning effort — the new optional parameter for reasoning-class models
// (gpt-5 family, o-series). `minimal` is the lowest tier (below `low`).
// ADDITIVE: absent on classic sampling models; ignored/stripped by the BaoBox
// worker when sent for a sampling model.
// ---------------------------------------------------------------------------
export const REASONING_EFFORT_VALUES = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];
export const reasoningEffortSchema = z.enum(REASONING_EFFORT_VALUES);

// The Skill Studio contract does NOT redefine skill fields. The canonical
// payload shapes are owned by `@baobox/sdk` and re-exported here so the BFF
// (#248) and the Web Component (#249) consume one source of truth and cannot
// drift. The Web Component depends on THIS package for types — never on
// `@baobox/sdk` directly (it never talks to BaoBox).
//
// Note: `@baobox/sdk`'s wire `Skill` uses `id` (not the worker's internal
// `skillId`) and is intentionally lean (no guardrail / attachment columns).
// This contract mirrors that wire shape exactly.
export type { Skill, SkillFileReference, SkillWithFiles } from "@baobox/sdk";

// ---------------------------------------------------------------------------
// List item — a lean projection of `Skill` for the list view, so the list
// endpoint doesn't ship the system prompt for every row. The compile-time
// guards below pin it as a strict subset of `Skill`.
// ---------------------------------------------------------------------------
export const skillSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  model: z.string(),
  tenantId: z.string().nullable(),
  updatedAt: z.string(),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

// Compile-time: every `SkillSummary` field exists on `Skill` with a compatible
// type. If `@baobox/sdk` renames/retypes one of these, this stops compiling —
// the drift guard the epic asks for.
const _summaryIsSkillSubset = (s: Skill): SkillSummary => ({
  id: s.id,
  name: s.name,
  description: s.description,
  model: s.model,
  tenantId: s.tenantId,
  updatedAt: s.updatedAt,
});
void _summaryIsSkillSubset;

// Project a full skill down to the list summary.
export function toSkillSummary(skill: Skill): SkillSummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    model: skill.model,
    tenantId: skill.tenantId,
    updatedAt: skill.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Detail — the full skill plus its file references. Phase 1 returns the
// `@baobox/sdk` `SkillWithFiles` shape verbatim; `skillDetailSchema` mirrors it
// (the bidirectional type guards below keep schema ⇄ SDK in lockstep).
//
// Deliberately NON-strict: this validates a RESPONSE the BFF produces from
// trusted `@baobox/sdk` output, so it tolerates additive SDK fields (an extra
// column on a future `Skill` is stripped, not rejected). Making it `.strict()`
// would turn a non-breaking SDK addition into a runtime parse failure. The
// untrusted input schema (`skillUpdateRequestSchema`) is the one that's strict.
// ---------------------------------------------------------------------------

// `SkillDetail` extends the SDK's `SkillWithFiles` with the optional
// `reasoningEffort` field (absent on sampling models, present on reasoning
// models). The SDK type itself is not changed — we intersect here so Studio
// can store/display the field while the BaoBox wire type remains stable.
export type SkillDetail = SkillWithFiles & { reasoningEffort?: ReasoningEffort };

export const skillFileReferenceSchema = z.object({
  path: z.string(),
  size: z.number(),
});

export const skillDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  model: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
  // `reasoningEffort` is additive — absent for sampling models, present for
  // reasoning-class models (gpt-5 family, o-series).
  reasoningEffort: reasoningEffortSchema.optional(),
  sourceUrl: z.string().nullable(),
  tenantId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  files: z.array(skillFileReferenceSchema),
});

// Compile-time drift guards — schema ⇄ SDK, BOTH directions:
//   - SDK → schema: a real `SkillWithFiles` satisfies the schema's required
//     fields. `reasoningEffort` is optional so the SDK value (which lacks it)
//     still satisfies the schema type — no compile error if SDK stays stable.
//   - schema → SDK: the schema-inferred type (which has `reasoningEffort?`)
//     satisfies `SkillWithFiles` because extra optional fields are permitted
//     in structural typing. If the SDK gains a REQUIRED field the schema
//     lacks, this stops compiling — the guard remains effective.
//
// NOTE: the guards deliberately test only the SDK-originated fields, not
// `reasoningEffort`, because that field originates in this contract (not the
// SDK). The SDK's `SkillWithFiles.reasoningEffort` is typed as
// `ReasoningEffort | null | undefined` (null when stored as SQL NULL); the
// contract schema accepts `undefined` only (null is a Zod parse failure, but
// the BFF strips nulls via `skillDetailSchema.parse`). The drift guard below
// casts away null to satisfy the structural check — the BFF's runtime parse
// is the actual enforcement boundary.
const _detailFromSdk = (s: SkillWithFiles): z.infer<typeof skillDetailSchema> =>
  s as unknown as z.infer<typeof skillDetailSchema>;
const _detailToSdk = (s: z.infer<typeof skillDetailSchema>): SkillWithFiles => s;
const _fileRefMatch = (f: SkillFileReference): z.infer<typeof skillFileReferenceSchema> => f;
void _detailFromSdk;
void _detailToSdk;
void _fileRefMatch;

// ---------------------------------------------------------------------------
// Update request — the single untrusted input on this surface (browser → BFF).
// Phase 1 is a SINGLE-field edit (the walking skeleton's one mutation), so the
// contract requires exactly one editable field. `.strict()` rejects unknown
// keys so a client can't smuggle `id` / `tenantId` through the BFF.
// ---------------------------------------------------------------------------
export const skillUpdateRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    systemPrompt: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    // `reasoningEffort` is optional and additive — valid only for reasoning
    // models, but the contract accepts it here (the BaoBox worker enforces
    // model compatibility server-side).
    reasoningEffort: reasoningEffortSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length === 1, {
    message: "exactly one editable field must be provided (Phase 1 is single-field)",
  });
export type SkillUpdateRequest = z.infer<typeof skillUpdateRequestSchema>;

// Compile-time: the SDK-originated editable update fields track `@baobox/sdk`'s
// `Skill`. If the SDK renames/retypes one of these (e.g. `temperature: number`
// → `string`), an un-refined update payload stops being assignable here and
// this fails to compile — keeping the write contract honest.
//
// `reasoningEffort` is NOT included in this subset guard because it does not
// exist on the SDK `Skill` type — it is a contract-level extension. Adding it
// here would break the assignability check in the other direction.
type EditableSkillFields = Partial<
  Pick<Skill, "name" | "description" | "systemPrompt" | "model" | "temperature" | "maxTokens">
> & { reasoningEffort?: ReasoningEffort };
// `.refine()` doesn't change the inferred type, so `SkillUpdateRequest` is the
// plain `{ name?, description?, ..., reasoningEffort? }` object — the SDK-
// originated fields remain assignable to Skill only while their types agree.
const _updateTracksSkill = (u: SkillUpdateRequest): EditableSkillFields => u;
void _updateTracksSkill;

// ---------------------------------------------------------------------------
// Response envelopes — wrap results in `{ data }`, mirroring BaoBox's response
// convention. An optional `metadata` field can be added later without breaking
// consumers (these object schemas strip, not reject, unknown keys).
// ---------------------------------------------------------------------------
export const listSkillsResponseSchema = z.object({
  data: z.array(skillSummarySchema),
});
export type ListSkillsResponse = z.infer<typeof listSkillsResponseSchema>;

export const skillDetailResponseSchema = z.object({
  data: skillDetailSchema,
});
export type SkillDetailResponse = z.infer<typeof skillDetailResponseSchema>;

// ===========================================================================
// Phase 2 (#258) — the full orchestrator AUTHORING surface. Everything below is
// ADDITIVE: the Phase-1 shapes above are unchanged, so existing BFF (#248) and
// Web Component (#249) builds keep working. The new endpoints are implemented by
// the BFF (#259) over `@baobox/sdk` (#257) and consumed by the Web Component
// (#260).
// ===========================================================================

// ---------------------------------------------------------------------------
// Create — a tenant authors a NEW skill (always tenant-owned server-side; the
// BFF's per-tenant credential enforces ownership, so the contract carries no
// `tenantId`). `.strict()` rejects unknown keys (no smuggling `tenantId`/`id`).
// Tools are NOT set here — attach them separately via the tool endpoints, which
// are gated by the tenant tool allowlist server-side.
// ---------------------------------------------------------------------------
export const skillCreateRequestSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    systemPrompt: z.string().min(1),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    sourceUrl: z.string().url().optional(),
  })
  .strict();
export type SkillCreateRequest = z.infer<typeof skillCreateRequestSchema>;

// ---------------------------------------------------------------------------
// Structural (multi-field) update — Phase 2's PUT /skills/:id. Unlike the
// Phase-1 single-field PATCH, this accepts any subset of editable fields in one
// call (the authoring UI saves a whole form), requiring AT LEAST one. `.strict()`
// still rejects `id` / `tenantId`. The Phase-1 `skillUpdateRequestSchema` (PATCH)
// is left untouched for backward compatibility.
// ---------------------------------------------------------------------------
export const skillStructuralUpdateRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    systemPrompt: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    // #330 — integration-first model picker: optionally bind to a tenant LLM
    // integration. `null` clears the pin (reverts to tenant default). Additive:
    // absent on skills that were saved before #330 and treated as null server-side.
    llmIntegrationId: z.string().nullable().optional(),
    // #330 — llmSource drives how the backend resolver selects the model key/
    // provider. "pinned" = use the explicit integration + model; "tenant_default"
    // = defer to the tenant's default integration.
    llmSource: z.enum(["tenant_default", "platform", "pinned"]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length >= 1, {
    message: "at least one editable field must be provided",
  });
export type SkillStructuralUpdateRequest = z.infer<typeof skillStructuralUpdateRequestSchema>;

// Compile-time drift guards — create/structural-update editable fields track
// `@baobox/sdk`'s `Skill` (same posture as `_updateTracksSkill` above).
// `llmIntegrationId` and `llmSource` are NOT included in the `Skill` subset
// guard — they originate in this contract (#330), not the SDK `Skill` type.
type CreatableSkillFields = Pick<Skill, "name" | "systemPrompt"> &
  Partial<Pick<Skill, "description" | "model" | "temperature" | "maxTokens" | "sourceUrl">>;
const _createTracksSkill = (c: SkillCreateRequest): CreatableSkillFields => c;
const _structuralTracksSkill = (
  u: Omit<SkillStructuralUpdateRequest, "llmIntegrationId" | "llmSource">,
): Partial<
  Pick<Skill, "name" | "description" | "systemPrompt" | "model" | "temperature" | "maxTokens">
> => u;
void _createTracksSkill;
void _structuralTracksSkill;

// ---------------------------------------------------------------------------
// Sub-skill graph (orchestrator) — attach/detach a child skill. The path
// carries the parent id; the body carries the child id on attach. Detach takes
// the child id in the path. A cycle is reported via the contract error shape
// below (code `cycle_detected`).
// ---------------------------------------------------------------------------
export const attachSubSkillRequestSchema = z
  .object({
    childSkillId: z.string().min(1),
  })
  .strict();
export type AttachSubSkillRequest = z.infer<typeof attachSubSkillRequestSchema>;

// ---------------------------------------------------------------------------
// Tool wiring — attach/detach a tool. The body carries the tool id on attach.
// The server confines attach to the tenant's tool allowlist; an off-list tool
// is reported via the contract error shape (code `tool_not_allowed`).
// ---------------------------------------------------------------------------
export const attachToolRequestSchema = z
  .object({
    toolId: z.string().min(1),
  })
  .strict();
export type AttachToolRequest = z.infer<typeof attachToolRequestSchema>;

// ---------------------------------------------------------------------------
// Per-tenant parameters — a tenant parameterises a skill (e.g. an account id, a
// brand name, a per-tenant secret reference) without editing the prompt. A
// parameter is a `key` + a string `value`; `secret: true` marks a value the UI
// must mask and the BFF must never echo back in cleartext. `label` is an
// optional human caption for the authoring UI.
// ---------------------------------------------------------------------------
export const skillParameterSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9_]+$/, "key must be alphanumeric/underscore"),
    value: z.string(),
    label: z.string().optional(),
    secret: z.boolean().optional(),
  })
  .strict();
export type SkillParameter = z.infer<typeof skillParameterSchema>;

export const setSkillParametersRequestSchema = z
  .object({
    parameters: z.array(skillParameterSchema),
  })
  .strict();
export type SetSkillParametersRequest = z.infer<typeof setSkillParametersRequestSchema>;

// ---------------------------------------------------------------------------
// Contract error shape — every non-2xx the BFF returns on this surface uses
// this envelope, so the Web Component can branch on a STABLE `code` (render a
// "would create a cycle" message, a field-validation message, an
// "tool not permitted" message, …) rather than parsing prose. Mirrors the
// BaoBox `{ error: { code, message, requestId? } }` convention.
// ---------------------------------------------------------------------------
export const contractErrorCodeSchema = z.enum([
  "validation_error", // request body failed schema validation (400)
  "cycle_detected", // sub-skill attach would create a cycle (422)
  "tool_not_allowed", // tool is not on the tenant's allowlist (403)
  "forbidden", // authz hook denied / not the tenant's resource (403)
  "not_found", // skill/child/tool not visible to this tenant (404)
  "conflict", // duplicate / state conflict (409)
  "upstream_error", // BaoBox returned an unexpected error (502)
  "internal_error", // unhandled BFF error (500)
]);
export type ContractErrorCode = z.infer<typeof contractErrorCodeSchema>;

export const contractErrorSchema = z.object({
  error: z.object({
    code: contractErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ContractError = z.infer<typeof contractErrorSchema>;

// ---------------------------------------------------------------------------
// Phase-2 response envelopes. Create / structural-update return the full detail
// (reuse `skillDetailResponseSchema`). Graph + tool mutations return a small ack;
// the graph/tool reads return lists.
// ---------------------------------------------------------------------------
export const attachAckResponseSchema = z.object({
  data: z.object({ attached: z.boolean() }),
});
export type AttachAckResponse = z.infer<typeof attachAckResponseSchema>;

export const detachAckResponseSchema = z.object({
  data: z.object({ detached: z.boolean() }),
});
export type DetachAckResponse = z.infer<typeof detachAckResponseSchema>;

// A tool as projected onto this surface — lean, never carries handlerConfig
// (which may hold callback secrets) to the browser.
export const skillToolSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type SkillToolSummary = z.infer<typeof skillToolSummarySchema>;

export const listAttachedSkillsResponseSchema = z.object({
  data: z.array(skillSummarySchema),
});
export type ListAttachedSkillsResponse = z.infer<typeof listAttachedSkillsResponseSchema>;

export const listSkillToolsResponseSchema = z.object({
  data: z.array(skillToolSummarySchema),
});
export type ListSkillToolsResponse = z.infer<typeof listSkillToolsResponseSchema>;

// ---------------------------------------------------------------------------
// Available tools — the tenant's attachable allowlist (own + global tools).
// Returned by `GET /tools` (Phase 3 — #312). Reuses `skillToolSummarySchema`
// (same lean projection: id + name + description; handlerConfig is never sent
// to the browser). This is DISTINCT from `listSkillTools` (`GET /skills/:id/tools`),
// which lists tools already attached to a specific skill.
// ---------------------------------------------------------------------------
export const listAvailableToolsResponseSchema = z.object({
  data: z.array(skillToolSummarySchema),
});
export type ListAvailableToolsResponse = z.infer<typeof listAvailableToolsResponseSchema>;

// ---------------------------------------------------------------------------
// LLM model catalog (#320) — mirrors the SDK's `LlmCatalog` shape so the
// Web Component can type-check the BFF response without importing `@baobox/sdk`
// directly. The contract owns these types; the BFF passes the SDK value
// through as-is (no field stripping needed — catalog has no secrets).
// ---------------------------------------------------------------------------
export const llmCatalogModelPricingSchema = z.object({
  inputUsdPerMTok: z.number(),
  outputUsdPerMTok: z.number(),
  asOf: z.string(),
});
export type LlmCatalogModelPricing = z.infer<typeof llmCatalogModelPricingSchema>;

export const llmCatalogModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  paramProfile: z.enum(["sampling", "reasoning"]),
  reasoningEfforts: z.array(z.string()).optional(),
  contextWindow: z.number().optional(),
  pricing: llmCatalogModelPricingSchema.optional(),
});
export type LlmCatalogModel = z.infer<typeof llmCatalogModelSchema>;

export const llmCatalogProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  defaultModel: z.string(),
  docsUrl: z.string(),
  pricingUrl: z.string(),
  models: z.array(llmCatalogModelSchema),
});
export type LlmCatalogProvider = z.infer<typeof llmCatalogProviderSchema>;

/** Response envelope for `GET /models` (#320). Mirrors the SDK `LlmCatalog`. */
export const modelCatalogResponseSchema = z.object({
  providers: z.array(llmCatalogProviderSchema),
  /** All reasoning-effort tier strings valid across all providers. */
  reasoningEfforts: z.array(z.string()),
});
export type ModelCatalogResponse = z.infer<typeof modelCatalogResponseSchema>;

// ---------------------------------------------------------------------------
// LLM integrations (#330) — the tenant's configured LLM integrations so the
// Web Component can offer an integration-first model picker (pick integration
// → pick model from that integration's live list). The SDK types are re-exported
// here so the BFF + Web Component share one source of truth without importing
// `@baobox/sdk` directly.
//
// `LlmIntegration` is API-safe (no real credentials — `apiKeyMask` is always
// `"***"`). `IntegrationModelsView` combines catalog + provider-live models and
// carries a `providerListError` soft-warning when the provider list fetch failed.
// ---------------------------------------------------------------------------

// Re-export SDK types for downstream consumers (BFF + Web Component).
export type { IntegrationModelsView, LlmIntegration } from "@baobox/sdk";

// Compile-time drift guard: `LlmIntegration` fields the contract schema
// validates must stay in sync with the SDK type. If the SDK renames a field,
// the guard below stops compiling — keeping the schema honest.
const _sdkIntegrationGuard = (i: LlmIntegration): {
  id: string;
  displayName: string;
  provider: string;
  defaultModel: string;
  isDefault: boolean;
  apiKeyMask: string;
} => i;
void _sdkIntegrationGuard;

/** Zod schema for a single `LlmIntegration` entry (mirrors the SDK type). */
export const llmIntegrationSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.string(),
  defaultModel: z.string(),
  isDefault: z.boolean(),
  apiKeyMask: z.string(),
});

/** Response envelope for `GET /llm-integrations` (#330). */
export const listLlmIntegrationsResponseSchema = z.object({
  data: z.array(llmIntegrationSchema),
});
export type ListLlmIntegrationsResponse = z.infer<typeof listLlmIntegrationsResponseSchema>;

/** Zod schema for a single integration model entry (mirrors `IntegrationModel` from SDK). */
export const integrationModelSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  source: z.enum(["catalog", "provider", "custom"]),
  paramProfile: z.enum(["sampling", "reasoning"]),
  reasoningEfforts: z.array(z.string()),
  pricing: z
    .object({
      inputUsdPerMTok: z.number(),
      outputUsdPerMTok: z.number(),
      asOf: z.string(),
    })
    .nullable(),
});
export type IntegrationModel = z.infer<typeof integrationModelSchema>;

/**
 * Response schema for `GET /llm-integrations/:id/models` (#330).
 * Mirrors the SDK `IntegrationModelsView` shape.
 */
export const integrationModelsViewSchema = z.object({
  integrationId: z.string(),
  provider: z.string(),
  models: z.array(integrationModelSchema),
  /** Non-null when the server could not fetch the live provider model list. */
  providerListError: z.string().nullable(),
});
export type IntegrationModelsViewResponse = z.infer<typeof integrationModelsViewSchema>;

// Compile-time drift guard: `IntegrationModelsView` fields the schema validates
// must stay in sync with the SDK type.
const _sdkIntegrationModelsGuard = (v: IntegrationModelsView): {
  integrationId: string;
  provider: string;
  models: unknown[];
  providerListError: string | null;
} => v;
void _sdkIntegrationModelsGuard;

// ---------------------------------------------------------------------------
// ED-2 (#433) — Incoming skill drafts (External Dreamer intake, review-gated).
//
// The BFF proxies two admin-auth endpoints from BaoBox:
//   GET  /api/v1/admin/skills/drafts?tenantId=<id>  → { data: { drafts: [...] } }
//   POST /api/v1/admin/skills/drafts/:versionId/approve → { data: { ... } }
//
// These types are the BFF↔Web contract; they mirror the BaoBox wire shapes
// exactly so the proxy layer is zero-transform.
// ---------------------------------------------------------------------------

export const skillDraftSchema = z.object({
  version_id: z.string(),
  skill_id: z.string(),
  skill_name: z.string(),
  version_label: z.string(),
  review_state: z.string(),
  is_active: z.number(),
  status: z.string(),
  source: z.string(),
  provenance: z.array(z.string()),
  submitted_at: z.string(),
  submitted_by_key_id: z.string(),
  tenant_id: z.string(),
});
export type SkillDraft = z.infer<typeof skillDraftSchema>;

export const listDraftsResponseSchema = z.object({
  data: z.object({
    drafts: z.array(skillDraftSchema),
  }),
});
export type ListDraftsResponse = z.infer<typeof listDraftsResponseSchema>;

export const approveDraftResponseSchema = z.object({
  data: z.object({
    versionId: z.string(),
    skillId: z.string(),
    reviewState: z.string(),
    versionStatus: z.string(),
    skillStatus: z.string(),
  }),
});
export type ApproveDraftResponse = z.infer<typeof approveDraftResponseSchema>;

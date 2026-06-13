import type { Skill, SkillFileReference, SkillWithFiles } from "@baobox/sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Reasoning effort — the new optional parameter for reasoning-class models
// (gpt-5 family, o-series). `minimal` is the lowest tier (below `low`).
// ADDITIVE: absent on classic sampling models; ignored/stripped by the BaoBox
// worker when sent for a sampling model.
// ---------------------------------------------------------------------------
export const REASONING_EFFORT_VALUES = ["minimal", "low", "medium", "high"] as const;
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
// SDK). Adding it as required to the SDK type would break the guard — keep it
// optional here and in `SkillDetail` above.
const _detailFromSdk = (s: SkillWithFiles): z.infer<typeof skillDetailSchema> => s;
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
  })
  .strict()
  .refine((body) => Object.keys(body).length >= 1, {
    message: "at least one editable field must be provided",
  });
export type SkillStructuralUpdateRequest = z.infer<typeof skillStructuralUpdateRequestSchema>;

// Compile-time drift guards — create/structural-update editable fields track
// `@baobox/sdk`'s `Skill` (same posture as `_updateTracksSkill` above).
type CreatableSkillFields = Pick<Skill, "name" | "systemPrompt"> &
  Partial<Pick<Skill, "description" | "model" | "temperature" | "maxTokens" | "sourceUrl">>;
const _createTracksSkill = (c: SkillCreateRequest): CreatableSkillFields => c;
const _structuralTracksSkill = (
  u: SkillStructuralUpdateRequest,
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

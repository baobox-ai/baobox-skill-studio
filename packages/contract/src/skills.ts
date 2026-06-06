import type { Skill, SkillFileReference, SkillWithFiles } from "@baobox/sdk";
import { z } from "zod";

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
export type SkillDetail = SkillWithFiles;

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
  sourceUrl: z.string().nullable(),
  tenantId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  files: z.array(skillFileReferenceSchema),
});

// Compile-time drift guards — schema ⇄ SDK, BOTH directions:
//   - SDK → schema: a real `SkillWithFiles` satisfies every schema field, so
//     if the schema gains a required field the SDK lacks, this stops compiling.
//   - schema → SDK: the schema-inferred type satisfies `SkillWithFiles`, so if
//     the SDK gains a required field the schema lacks, this stops compiling.
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
  })
  .strict()
  .refine((body) => Object.keys(body).length === 1, {
    message: "exactly one editable field must be provided (Phase 1 is single-field)",
  });
export type SkillUpdateRequest = z.infer<typeof skillUpdateRequestSchema>;

// Compile-time: the editable update fields track `@baobox/sdk`'s `Skill`. If the
// SDK renames/retypes one of these (e.g. `temperature: number` → `string`), an
// un-refined update payload stops being assignable here and this fails to
// compile — keeping the write contract honest against the canonical type.
type EditableSkillFields = Partial<
  Pick<Skill, "name" | "description" | "systemPrompt" | "model" | "temperature" | "maxTokens">
>;
// `.refine()` doesn't change the inferred type, so `SkillUpdateRequest` is the
// plain `{ name?, description?, ... }` object — assignable to the editable
// subset of `Skill` only while their field types agree.
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

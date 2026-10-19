# Changelog

## 0.8.0

Track `@baobox/sdk` 0.32.x (types from 0.32.0; pinned `^0.32.1`, which
returns the role-model map unwrapped). Decision skills and decision-model role
pins. Refs baobox#846. **Additive except one type widening (see Changed).**

### Added

- `roleModelChainEntrySchema` accepts an optional `mode: "chat" | "decision"`
  (still `.strict()`; an unknown key is still rejected). An omitted `mode` stays
  omitted so the server can infer it. New `ROLE_MODEL_MODES` tuple and a
  re-exported `RoleModelMode` type.
- `skillDetailSchema` carries `skillKind` and `decisionSpec` (both optional),
  so a parse keeps them instead of stripping them. `skillSummarySchema` and
  `toSkillSummary` carry `skillKind` (copied only when the server sent it) for
  the list badge; the summary never carries the spec.
- `SKILL_KINDS`, `skillKindSchema`, `isDecisionSkill()`, and re-exported
  `SkillKind` / `DecisionSkillSpec` types.
- `skillRoleModelsMapSchema` (+ `storedRoleModelEntrySchema`,
  `ROLE_MODELS_SHAPE_ERROR`): the `GET /skills/:id/role-models` response. All
  four roles are required and each must be an array of entries with a known
  `llmSource` / `mode`; server fields pass through. The `{ skillId, roles }`
  wrapper from `@baobox/sdk` < 0.32.1 does not parse. The BFF and the Web
  Component use it to fail closed: a payload that does not parse is a load
  error, never "empty chains".

### Changed

- `llmIntegrationSchema.defaultModel` is now `string | null` (was `string`),
  matching SDK 0.32.0. The server has always allowed an integration with no
  default model, so a parse of such a row used to fail.

### Unchanged on purpose

- The write schemas (`skillCreateRequestSchema`, `skillUpdateRequestSchema`,
  `skillStructuralUpdateRequestSchema`) do not accept `skillKind` or
  `decisionSpec`: Studio does not create or edit decision skills (the kind is
  immutable server-side, and the spec is edited in the BaoBox Portal).
- `llmCatalogProviderSchema.defaultModel` stays `string`: the catalog route and
  the SDK's `LlmCatalogProvider` still type it as a string.

### Docs

- The `roleModelChainEntrySchema` doc comment no longer describes
  `{ llmIntegrationId: null, llmSource: "pinned" }` as Studio's body: the server
  has always rejected that with 400 `invalid_role_model`.

## 0.7.1

Metadata refresh, no API change.

## 0.7.0

Align `@baobox/sdk` to `^0.22.0`. No contract surface change — the re-exported
SDK types are identical; this keeps the dependency from pulling a stale nested
SDK into BFF/web clean installs.

## 0.2.1

Model-aware reasoning effort (#11 / #302). **Additive, backward compatible.**

- `REASONING_EFFORT_VALUES` widened to the full OpenAI-SDK set:
  `["none", "minimal", "low", "medium", "high", "xhigh"]` (was
  `["minimal","low","medium","high"]`). `ReasoningEffort` and
  `reasoningEffortSchema` derive from it. Which tiers a model accepts is
  model-dependent and enforced server-side; the schema accepts the full set.
- No breaking changes: existing fields and routes unchanged; the drift guard
  vs `@baobox/sdk` skill types still holds.

## 0.2.0

Phase-2 authoring surface (#258). **Backward compatible** — every Phase-1 shape
and route (`listSkills`, `getSkill`, `PATCH updateSkill`, the summary/detail/
single-field-update schemas and response envelopes) is unchanged.

### Added

- **Routes** (`skillStudioRoutes`): `createSkill` (POST /skills),
  `updateSkillStructural` (PUT /skills/:id), `listAttachedSkills` / `attachSubSkill`
  (POST, body `{ childSkillId }`) / `detachSubSkill` (DELETE …/:childId),
  `listSkillTools` / `attachTool` (POST, body `{ toolId }`) / `detachTool`
  (DELETE …/:toolId), and `getSkillParameters` / `setSkillParameters`.
- **Schemas + types**: `skillCreateRequestSchema`, `skillStructuralUpdateRequestSchema`
  (multi-field, ≥1, `.strict()`), `attachSubSkillRequestSchema`,
  `attachToolRequestSchema`, `skillParameterSchema` / `setSkillParametersRequestSchema`,
  and lean read projections `skillToolSummarySchema` + the new response envelopes
  (`attachAckResponseSchema`, `detachAckResponseSchema`,
  `listAttachedSkillsResponseSchema`, `listSkillToolsResponseSchema`).
- **Contract error shape**: `contractErrorSchema` + `contractErrorCodeSchema`
  (`validation_error` / `cycle_detected` / `tool_not_allowed` / `forbidden` /
  `not_found` / `conflict` / `upstream_error` / `internal_error`) so the Web
  Component branches on a stable `code` (e.g. render a clear "would create a
  cycle" or "tool not permitted" message).
- Compile-time drift guards tying the create/structural-update editable fields to
  `@baobox/sdk`'s `Skill`.

## 0.1.0

Initial release — the Phase-1 BFF↔MFE contract for the BaoBox Skill Studio
(Epic #244, ν1.1 / #246).

- `SkillSummary` (lean list projection of `@baobox/sdk` `Skill`) + `toSkillSummary`.
- `SkillDetail` (re-export of `@baobox/sdk` `SkillWithFiles`) + `skillDetailSchema`.
- `SkillUpdateRequest` (`.strict()`, exactly one editable field — Phase 1 is
  single-field).
- Response envelopes: `listSkillsResponseSchema`, `skillDetailResponseSchema`.
- Route descriptors: `skillStudioRoutes` (`GET /skills`, `GET /skills/:id`,
  `PATCH /skills/:id`).
- Compile-time drift guards pinning the contract shapes to `@baobox/sdk`.

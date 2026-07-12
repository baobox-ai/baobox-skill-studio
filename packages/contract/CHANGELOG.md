# Changelog

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

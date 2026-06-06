# Changelog

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

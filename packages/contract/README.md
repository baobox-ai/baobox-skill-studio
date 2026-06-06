# @baobox/skill-builder-contract

The shared **BFF↔MFE HTTP contract** for the BaoBox **Skill Studio**.

This package defines the small HTTP surface that the embedded
`<baobox-skill-builder>` Web Component (`@baobox/skill-builder`, #249) fetches
from the **tenant's own backend** (the BFF, `@baobox/skill-builder-bff`, #248).
It is **not** the BaoBox API — the browser never calls BaoBox directly.

Payload shapes **reuse** `@baobox/sdk`'s skill types (`Skill`,
`SkillWithFiles`, `SkillFileReference`) so the server and the browser share one
source of truth and cannot drift.

> Part of Epic #244, Phase 1 (walking skeleton): **list skills · get one ·
> update one field**. Sub-skill graphs, tools, and the create wizard are Phase 2.

## Install

```sh
npm install @baobox/skill-builder-contract
# peer/runtime: zod, and @baobox/sdk (for the re-exported skill types)
```

## The Phase-1 surface

All paths are relative to the BFF mount point (the `api-base` the host sets on
`<baobox-skill-builder>`). They do **not** include BaoBox's `/api/v1` prefix —
this is the tenant BFF's own surface.

| Op            | Method & path      | Request (validated)         | Response                  |
| ------------- | ------------------ | --------------------------- | ------------------------- |
| List skills   | `GET /skills`      | —                           | `{ data: SkillSummary[] }`|
| Get a skill   | `GET /skills/:id`  | —                           | `{ data: SkillDetail }`   |
| Update field  | `PATCH /skills/:id`| `SkillUpdateRequest`        | `{ data: SkillDetail }`   |

```ts
import {
  skillStudioRoutes,
  skillUpdateRequestSchema,
  listSkillsResponseSchema,
  skillDetailResponseSchema,
  toSkillSummary,
  type SkillSummary,
  type SkillDetail,        // = @baobox/sdk SkillWithFiles
  type SkillUpdateRequest,
} from "@baobox/skill-builder-contract";

skillStudioRoutes.getSkill.build("sk_default"); // "/skills/sk_default"
```

## Shapes

- **`SkillSummary`** — lean list row: `{ id, name, description, model, tenantId, updatedAt }`
  (a strict subset of `@baobox/sdk`'s `Skill`; use `toSkillSummary(skill)`).
- **`SkillDetail`** — re-export of `@baobox/sdk`'s `SkillWithFiles`
  (full skill + `files: { path, size }[]`).
- **`SkillUpdateRequest`** — **exactly one** editable field per request
  (Phase 1 is a single-field edit), chosen from `name`, `description`,
  `systemPrompt`, `model`, `temperature`, `maxTokens`. The schema is `.strict()`
  — unknown keys (e.g. `id`, `tenantId`) are rejected so a client can't smuggle
  them through the BFF.

## Validation at the BFF boundary

```ts
// In the BFF, validate the untrusted PATCH body before calling @baobox/sdk:
const parsed = skillUpdateRequestSchema.safeParse(await req.json());
if (!parsed.success) return badRequest(parsed.error);
```

Response schemas (`listSkillsResponseSchema`, `skillDetailResponseSchema`) are
provided for the BFF to validate/normalize its own output and for tests.

## Versioning

`0.1.0`. Published from the `baobox-skill-studio` monorepo via a tag-driven
release (`contract-v*` → GitHub Actions → npm), mirroring `@baobox/sdk`.

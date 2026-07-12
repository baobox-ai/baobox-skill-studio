# Changelog

## 0.8.1

Metadata refresh, no API change.

## 0.8.0

Depend on `@baobox/sdk` `^0.22.0` (+ contract `^0.7.0`). Fixes the skill page's
auto-loaded model-catalog (`/models`) and tool-list (`/tools`) calls returning
**500** for apiKey BFFs: SDK 0.22.0 routes `catalog.list()` + `tools.list()`
through the apiKey-compatible request path, and the backend exposes the tool
list to a tenant apiKey (own + global). No BFF code change.

## 0.3.0

Phase-2 authoring surface + git-truth mutation hook (#259).

### Added

- **Authoring endpoints** implementing the `@baobox/skill-builder-contract`
  Phase-2 surface over the `@baobox/sdk` apiKey path, all tenant-scoped:
  - `POST /skills` — create a tenant-owned skill (returns the full detail, 201).
  - `PUT /skills/:id` — structural multi-field update.
  - `GET|POST /skills/:id/attached-skills` + `DELETE …/:childId` — orchestrator
    sub-skill graph (a worker `422` surfaces as the contract `cycle_detected`).
  - `GET|POST /skills/:id/tools` + `DELETE …/:toolId` — tool wiring (a worker
    `403` on attach surfaces as `tool_not_allowed`). The tool **list is projected
    to `{ id, name, description }`** — `handlerConfig` / `inputSchema` (which may
    carry callback secrets) are NEVER shipped to the browser.
  - `GET|PUT /skills/:id/parameters` — per-tenant parameters (see below).
- **`hooks.onMutation({ op, skillId, before?, after?, childSkillId?, toolId? })`**
  — the git-truth control point. Fires AFTER a structural mutation commits so the
  host can record drift / queue a promote-back. It is a notification, not a gate
  (the gate is `authz`, before the write); a throwing `onMutation` never fails the
  request (the failure is audited). Default: no-op. `before`/`after` carry the
  skill image for `create`/`update`/`updateStructural`; graph/tool/parameter ops
  carry the `op` + target id.
- **`hooks.parameters` parameter store** — per-tenant parameters have no BaoBox
  backing, so persistence is delegated to the host. Omit it and `GET …/parameters`
  returns `[]` while `PUT …/parameters` is refused (403). A parameter marked
  `secret: true` has its value **masked (blanked) in every response** — a secret
  value is never echoed to the browser.
- Extended the `authz` op union and `AuditRecord` to the new ops, including the
  `childSkillId` / `toolId` targets.

### Changed

- Upstream errors are now normalized to the contract's stable
  `ContractErrorCode` enum (the Web Component branches on `code`), with
  op-aware disambiguation for `cycle_detected` (attach 422) and
  `tool_not_allowed` (tool-attach 403). The Phase-1 validation code is now
  `validation_error` (was `invalid_request`); statuses are unchanged.
- Bumped `@baobox/sdk` to `^0.16.0` (the #257 authoring ops) and
  `@baobox/skill-builder-contract` to `^0.2.0`.

### Unchanged (by design)

- Credential redaction, fail-closed `authz` default, and the exactly-one-of
  `apiKey`/`adminSecret` construction rule — all preserved. The Phase-1
  list/get/PATCH behaviour and the read-side `sourceOfTruth` decorators are
  byte-for-byte compatible.

## 0.2.0

Per-tenant credential (#254 AC1).

### Added

- `apiKey` config option — a tenant-bound BaoBox key carrying
  `skills:read` / `skills:write`. **Recommended** over `adminSecret`: the
  credential itself enforces the tenant boundary, so a breached BFF can never
  reach another tenant's skills. Requires `@baobox/sdk` >= 0.15.0 and a BaoBox
  server with #254 worker support.
- The redaction backstop now scrubs **both** credentials (`apiKey` and
  `adminSecret`) from every outgoing error string.

### Changed

- `adminSecret` is now **optional**. Provide **exactly one** of `apiKey`
  (recommended) or `adminSecret` — construction throws otherwise.
- Bumped `@baobox/sdk` to `^0.15.0`.

### Migration

Replace `adminSecret: env.BAOBOX_ADMIN_SECRET` with
`apiKey: env.BAOBOX_SKILLS_KEY` (a per-tenant key). The `adminSecret` path
still works if you keep it.

## 0.1.0

Initial release — the Phase-1 Skill Studio BFF router (Epic baobox#244, ν1.3 /
#248).

- `createSkillBuilderBff({ endpoint, adminSecret, tenantId, hooks })` → a
  mountable Hono router implementing the `@baobox/skill-builder-contract`
  Phase-1 surface (`GET /skills`, `GET /skills/:id`, `PATCH /skills/:id`).
- Calls `@baobox/sdk` `skills.list/get/update` **scoped to `tenantId`** (#247) —
  no hand-rolled HTTP.
- Pluggable hooks: `authz` (deny → 403, before any BaoBox call), `audit`
  (best-effort; never fails the request), `sourceOfTruth` (optional list/detail
  overrides).
- **Fail-closed by default (#254):** with no `authz` hook, every request is
  denied (403) and a warning is logged at mount; set `allowUnauthenticated: true`
  to opt out deliberately. A forgotten hook can never silently expose skill
  read/write.
- `adminSecret` never appears in any response/error (status/code mapping +
  secret redaction backstop).
- `PATCH` validates the body via the contract's single-field
  `skillUpdateRequestSchema`, then re-fetches detail so the response carries
  files.
- Unit tests with a stubbed `@baobox/sdk` covering list/get/update round-trip,
  validation (empty/multi-field/unknown-key → 400), the 403 authz path, audit
  records, error mapping, and secret hygiene.

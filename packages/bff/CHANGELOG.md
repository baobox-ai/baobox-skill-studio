# Changelog

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

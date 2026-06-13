# Changelog

## 0.2.1

Model-aware model picker + reasoning effort (#11 / #302).

- Catalog-fed model picker grouped by provider (free-text still allowed); the
  parameter panel switches by model family (reasoning → effort; sampling →
  temperature/maxTokens).
- The reasoning-effort selector is **model-aware** — it offers only the tiers
  the selected model accepts (gpt-5/-mini/-nano → minimal/low/medium/high;
  gpt-5.4/5.5 → none/low/medium/high/xhigh). Added gpt-5.4 / gpt-5.5 to the
  catalog. Bumps `@baobox/skill-builder-contract` to `^0.2.1`.

## 0.2.0

Full orchestrator authoring UI (#260) + BaoBox#264 Defect B.

### Added

- **Create-skill wizard** — `+ New skill` opens a form (name + system prompt
  required; description / model optional); on create it navigates straight to the
  new skill's detail so sub-skills / tools / parameters can be wired up.
- **Structural editor** — the detail view now edits name, description, system
  prompt, model, temperature, and max-tokens in one save (`PUT /skills/:id`),
  sending only the changed fields (replaces the Phase-1 single-field description
  edit in the UI).
- **Sub-skill graph** — a DAG view of a skill's attached children with
  attach (from a candidate picker) / detach, and **cycle-rejection UX**: the
  contract `cycle_detected` (422) is surfaced as "would create a cycle in the
  orchestrator graph."
- **Tool wiring** — list attached tools (lean `{ id, name, description }`),
  attach by id, detach. An off-allowlist attach is rejected server-side
  (`tool_not_allowed`, 403) and surfaced as an allowlist message.
- **Per-tenant parameters** — key / value (+ optional label, secret) editor
  (`GET`/`PUT /skills/:id/parameters`). Secret values arrive masked and are
  write-only. To avoid wiping a secret the browser can't read, a `secret: true`
  row sent with an **empty value** is the documented **"keep current value"**
  signal (the BFF's parameter store retains it); typing replaces it, removing the
  row deletes it. Numeric fields (temperature 0–2, positive-integer max-tokens)
  are validated client-side before save.
- **`isSystem` / `cloneable` (BaoBox#264 Defect B)** — a system skill renders
  **read-only** (no editable form); when `cloneable`, a **"Copy as my own"**
  action creates a tenant-owned copy and opens it. These fields ride through on
  the wire as additive runtime properties (the SDK/BFF pass unknown response
  fields through), so no contract release is required.

### Changed

- **Theming depth** — colors are now **CSS custom properties** (`--bb-bg`,
  `--bb-fg`, `--bb-accent`, `--bb-radius`, …) defined on `:host` (with a
  `theme="dark"` override) and injected into the shadow root, so a host page can
  brand the element from its own CSS. The `theme` attribute still selects the
  built-in light/dark defaults.
- Bumped `@baobox/skill-builder-contract` to `^0.2.0`.

### Unchanged (by design)

- Still reads **everything** from `api-base` (the tenant BFF) with
  `credentials: "same-origin"`, never calls BaoBox, never imports `@baobox/sdk`,
  and never holds a credential. Standalone bundle + React wrapper unchanged in
  shape; pin/SRI story unchanged.

## 0.1.0

Initial release — the Phase-1 Skill Studio Web Component (Epic baobox#244, ν1.4 /
#249).

- `<baobox-skill-builder api-base theme>` custom element (shadow DOM,
  style-isolated) wrapping the Preact list + detail + edit-one-field slice.
- Reads ALL data from `api-base` via `@baobox/skill-builder-contract` — no
  `credentials: "include"`, no BaoBox cookie/session, never imports `@baobox/sdk`.
- `createApi(apiBase)` — configurable-base, contract-typed, cookie-less client.
- `registerSkillBuilder()` (npm) + a prebuilt **standalone** bundle
  (`dist/standalone/baobox-skill-builder.js`, Preact inlined, self-registering).
- Thin typed React wrapper `@baobox/skill-builder/react` → `<SkillBuilder />`.
- Vite **lib mode** build + a local **dev harness** (`npm run dev`) that mounts
  the element against an in-memory mock BFF (no live backend).
- Tests: API client (URL/method/body, no credentials, error mapping) and the
  component (list render, open detail, single-field save, error+retry) under
  jsdom, plus element registration.

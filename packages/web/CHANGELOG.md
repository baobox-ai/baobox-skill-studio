# Changelog

## 0.8.0

Decision-skill awareness and working guard chains. Depends on contract
`^0.8.0` (SDK 0.32.0 types). Refs baobox#846.

### Fixed

- **Guard chains now save. They never did before: every save returned 400
  `invalid_role_model`.** The per-role panel sent
  `{ llmIntegrationId: null, model, llmSource: "pinned" }`, and BaoBox requires
  an integration on every `pinned` entry. Guard and main-backup slots now send
  `{ llmIntegrationId: null, model, llmSource: "tenant_default", mode: "chat" }`:
  the slot runs on the tenant's default LLM integration, and the chosen model is
  used when it belongs to that integration's provider (otherwise the
  integration's default model is used). Each slot's caption says so.
- A slot's selection is no longer reset when the panel's first effect runs
  after the user has already picked a model.

### Added

- A role whose saved chain has a `mode: "decision"` entry is read-only: the
  selects, Save and Inherit default are disabled, with the note "set in the
  Portal (decision model)". Studio can't change a decision pin into a chat pin.
  A chain pinned to a specific integration (or the platform key) is read-only
  for the same reason. The status line marks decision entries.
- Decision skills (`skillKind: "decision"`): a `decision` badge in the list and
  on the skill page; the system prompt is labelled **Preamble** with a 4000
  character counter (save is blocked above it); the question spec is shown
  read-only as JSON. The model / integration picker, temperature / max tokens /
  reasoning effort, tools, sub-skills, main backup and postflight guard rows are
  hidden (BaoBox refuses each with a 422 on a decision skill). Only the
  preflight guard row remains. A save sends only the changed name /
  description / preamble.

## 0.7.1

Metadata refresh, no API change.

## 0.7.0

Stop eagerly fetching the global model catalog on the skill page. The
integration-first picker (#330) provides per-integration models + paramProfiles
for the primary flow, and the bundled static catalog covers the
ModelParamPanel family/effort fallback and the no-integrations free-text case.
Removes one request per skill page and the 500 it produced for off-box (apiKey)
BFFs. Depends on contract `^0.7.0`.

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

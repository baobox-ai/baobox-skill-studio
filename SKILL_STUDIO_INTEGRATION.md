# Skill Studio — tenant integration & onboarding

This guide is the contract a tenant follows to embed the BaoBox **Skill Studio**.
It is generic: nothing here is specific to any one tenant. It now covers the
**full Phase-2 authoring surface** (create · structural edit · sub-skill graph ·
tools · per-tenant parameters), built additively on top of the Phase-1 walking
skeleton (list · open · single-field edit).

The design has two hard rules:

1. The tenant's **browser never calls BaoBox directly.**
2. The tenant's **own backend** (holding its BaoBox credential) performs all real
   operations.

So onboarding is **two steps**: mount a BFF on your backend, then embed the Web
Component pointed at that BFF.

```
Browser:  <baobox-skill-builder api-base="/api/skill-studio">
                       │  fetch (same-origin session; no BaoBox secrets)
                       ▼
Your backend:  @baobox/skill-builder-bff  ──(apiKey, tenant-scoped)──▶  BaoBox
                       via @baobox/sdk
```

## Packages & versions

| Package | Version | Where it runs | Role |
| ------- | ------- | ------------- | ---- |
| [`@baobox/sdk`](https://www.npmjs.com/package/@baobox/sdk) | `^0.19.0` | your backend | BaoBox HTTP client (tenant-scoped skills #247 + authoring ops #257 + model catalog #320 + per-role models #328) |
| [`@baobox/skill-builder-contract`](https://www.npmjs.com/package/@baobox/skill-builder-contract) | `^0.5.0` | both | shared BFF↔MFE HTTP contract (types + Zod) |
| [`@baobox/skill-builder-bff`](https://www.npmjs.com/package/@baobox/skill-builder-bff) | `^0.6.0` | your backend | mountable Hono BFF router |
| [`@baobox/skill-builder`](https://www.npmjs.com/package/@baobox/skill-builder) | `^0.5.0` | browser | `<baobox-skill-builder>` Web Component |

These four versions are a **compatibility set** — install them together. The
contract is the pinned interface between the BFF (`^0.6.0`) and the Web Component
(`^0.5.0`); both depend on `@baobox/skill-builder-contract@^0.5.0`, and the BFF
additionally needs `@baobox/sdk@^0.19.0` (the SDK that adds
`client.skills.roleModels.get/put()` for per-role guard model config #328).
Mixing a `0.5.x` web bundle with a `0.5.x` BFF loses the `getRoleModels` /
`putRoleModels` endpoints (404 → panel shows a load error) — keep the set aligned.

> Phase 2 is **additive**: the Phase-1 endpoints keep their exact method+path, so
> an existing Phase-1 integration keeps working after the upgrade — you opt into
> the new surface by using the new UI/endpoints, nothing breaks implicitly.

## Prerequisites

- A BaoBox **endpoint** URL and a per-tenant **`apiKey`** for your environment.
  For Phase-2 authoring the key's `permissions` array carries the grants your
  tenant is allowed to use (see [The key's grants](#the-keys-grants-257)):
  - `skills:read` / `skills:write` — Phase-1 read + edit.
  - `skills:create` — author new (tenant-owned) skills.
  - `skills:attach` — attach/detach sub-skills (orchestrator graph).
  - `skills:tools` — attach/detach tools, **confined to** the key's `tool:<id>`
    allowlist entries.
  - The legacy cross-tenant `adminSecret` still works for a single-tenant staging
    skeleton, but it can reach every tenant — prefer a per-tenant `apiKey`.
- Your **`tenantId`** (the BaoBox tenant this app acts as).
- A backend that can mount a [Hono](https://hono.dev) router (reference runtime:
  Hono on Cloudflare Workers). Other runtimes can wrap the router with a Hono
  adapter.

Keep the credential (`apiKey` / `adminSecret`) **server-side only** — it must
never reach the browser.

---

## Step 1 — Mount the BFF on your backend

```sh
npm install @baobox/skill-builder-bff @baobox/sdk hono
```

```ts
import { Hono } from "hono";
import { createSkillBuilderBff } from "@baobox/skill-builder-bff";

const app = new Hono();

const skillStudio = createSkillBuilderBff({
  endpoint: env.BAOBOX_ENDPOINT,        // your BaoBox worker URL
  apiKey: env.BAOBOX_SKILLS_KEY,        // per-tenant key (recommended) — server-side only
  tenantId: "t_your_tenant",            // every call is scoped to this tenant (#247)
  hooks: {
    // REQUIRED in practice — the BFF is FAIL-CLOSED: with no authz hook every
    // request is denied (403). Wire this to YOUR session/permission model.
    // (To run without one — only behind another auth layer — set
    // `allowUnauthenticated: true` at the top level instead of a hook.)
    authz: ({ op, skillId }) => currentUserMayEdit(op, skillId),
    // Best-effort; a throw here never fails the request.
    audit: (record) => auditLog.write(record),
    // Phase 2 — fired AFTER a structural mutation commits (git-truth #259).
    // Best-effort, default no-op. See "The onMutation git-truth hook".
    onMutation: (event) => driftQueue.record(event),
    // Phase 2 — per-tenant parameter store (no BaoBox backing; host's data).
    // Omit to disable the parameter endpoints. See "Per-tenant parameters".
    parameters: {
      get: ({ tenantId, skillId }) => paramStore.read(tenantId, skillId),
      set: (params, { tenantId, skillId }) => paramStore.write(tenantId, skillId, params),
    },
  },
});

// Mount under any base path. Remember this path — the element's `api-base`.
app.route("/api/skill-studio", skillStudio);
```

That's the entire backend surface. The BFF builds an `@baobox/sdk` client from
your `{ endpoint, apiKey | adminSecret }` and calls the tenant-scoped `skills.*`
methods (`list`/`get`/`update` plus the Phase-2 `create`/`attachSkill`/
`detachSkill`/`listAttachedSkills`/`attachTool`/`detachTool`/`listTools`) **scoped
to `tenantId`** — it never hand-rolls HTTP, and the credential never appears in
any response or error.

### Config & hooks

```ts
createSkillBuilderBff({
  endpoint: string,
  // EXACTLY ONE credential (server-side only):
  apiKey?: string,       // per-tenant key with the skills:* grants — RECOMMENDED (#254/#257)
  adminSecret?: string,  // cross-tenant admin secret — legacy; reaches every tenant
  tenantId: string,
  hooks?: {
    // false/throw → 403. Runs BEFORE any BaoBox call, on URL-derived context only.
    authz?: (ctx: { op: SkillStudioOp; tenantId: string;
                    skillId?: string; childSkillId?: string; toolId?: string })
              => boolean | void | Promise<boolean | void>,
    // Best-effort observability sink; never fails the request.
    audit?: (record: { op; tenantId; skillId?; childSkillId?; toolId?;
                       outcome: "allowed"|"denied"|"error";
                       updatedField?; updatedFields?; error?: { status; code } })
              => void | Promise<void>,
    sourceOfTruth?: {                          // optional READ decorators; default off
      list?:   (summaries, { tenantId }) => SkillSummary[] | Promise<SkillSummary[]>,
      detail?: (detail, { tenantId, skillId }) => SkillDetail | Promise<SkillDetail>,
    },
    // Phase 2 — git-truth WRITE control point; best-effort; default no-op.
    onMutation?: (event: { op: SkillStudioMutationOp; tenantId: string; skillId: string;
                           childSkillId?: string; toolId?: string;
                           before?: SkillDetail; after?: SkillDetail }) => void | Promise<void>,
    // Phase 2 — per-tenant parameter store. Omit → parameter endpoints disabled.
    parameters?: {
      get: ({ tenantId, skillId }) => SkillParameter[] | Promise<SkillParameter[]>,
      set: (params, { tenantId, skillId }) => SkillParameter[] | void | Promise<SkillParameter[] | void>,
    },
  },
  allowUnauthenticated?: boolean,  // default false — fail-closed (see Security)
  client?: BaoBoxClient,           // inject a pre-built/stubbed client (tests)
  fetch?: typeof fetch,            // forwarded to the SDK client
})
```

Per request the BFF runs **authz → SDK call → (onMutation, on writes) → audit →
contract-shaped response.**

The op set (`SkillStudioOp`) the `authz`/`audit` hooks see:

- **reads** — `list`, `get`, `listAttachedSkills`, `listTools`, `listAvailableTools`, `getParameters`, `listModels`, `getRoleModels`
- **mutations** — `create`, `update` (Phase-1 PATCH), `updateStructural`
  (Phase-2 PUT), `attachSkill`, `detachSkill`, `attachTool`, `detachTool`,
  `setParameters`, `putRoleModels`

---

## Step 2 — Embed the Web Component

Load the standalone bundle (Preact inlined, self-registers) from a **stable,
versioned URL** you control or a CDN, and drop the element in, pointing
`api-base` at the path where you mounted the BFF:

```html
<script type="module"
        src="https://unpkg.com/@baobox/skill-builder@0.2.0/dist/standalone/baobox-skill-builder.js"></script>

<baobox-skill-builder api-base="/api/skill-studio" theme="light"></baobox-skill-builder>
```

| Attribute  | Required | Notes                                   |
| ---------- | -------- | --------------------------------------- |
| `api-base` | yes      | The BFF mount path from Step 1.         |
| `theme`    | no       | `"light"` (default) or `"dark"`.        |

The element now renders the **full authoring** experience: a skill list with a
**+ New skill** wizard, a detail view that edits the whole form (saved as one
structural `PUT`), a sub-skill **graph** panel (attach/detach with cycle-rejection
UX), a **tools** panel (attach-by-id with allowlist-rejection UX), and a
**parameters** panel. System (global) skills render **read-only** with a
**“Copy as my own”** action when cloneable (BaoBox#264).

> Pin the bundle version (don't float `@latest`) so a Studio upgrade is a
> deliberate change on your side. Mirror the file to your own CDN/static host if
> you don't want a runtime dependency on a public registry CDN.

### React host

```sh
npm install @baobox/skill-builder react react-dom
```

```tsx
import { SkillBuilder } from "@baobox/skill-builder/react";

export function SkillsAdmin() {
  return <SkillBuilder apiBase="/api/skill-studio" theme="light" />;
}
```

The browser makes requests **only** to `api-base` (your BFF) — never to BaoBox.
They use `credentials: "same-origin"`, so your tenant session reaches a
same-origin BFF (for `authz`) but nothing is sent cross-origin or to BaoBox. The
BFF is the auth boundary; the browser holds no BaoBox credentials.

### Theming (brand tokens)

Colors and radius are **CSS custom properties** on the element, so a host page
brands it from its own CSS — no internals, no rebuild:

```css
baobox-skill-builder {
  --bb-accent: #e11d48;
  --bb-radius: 12px;
  --bb-bg: #fffaf5;
}
```

Available tokens (each is `var(--bb-…, <built-in fallback>)` inside the element):

| Token | Role |
| ----- | ---- |
| `--bb-bg` | surface background |
| `--bb-fg` | primary text |
| `--bb-muted` | secondary/label text |
| `--bb-border` | borders / dividers |
| `--bb-accent` | primary action / focus |
| `--bb-accent-fg` | text on the accent |
| `--bb-card` | card / panel background |
| `--bb-danger` | error text / destructive |
| `--bb-success` | success ("Saved ✓") |
| `--bb-radius` | corner radius |
| `--bb-font` | font family |

The `theme="dark"` attribute swaps the built-in defaults (a dark palette); a host
rule overrides either theme. All of this lives in the element's shadow root, so it
never leaks styles into — or inherits unexpected styles from — the host page.

---

## The HTTP contract (BFF ↔ MFE)

The element calls these on `api-base`. Shapes come from
`@baobox/skill-builder-contract` and reuse `@baobox/sdk`'s skill types. Paths are
relative to the mount point and do **not** include BaoBox's `/api/v1` prefix —
this is the tenant BFF's own surface.

### Phase 1 — reads + single-field edit

#### `GET /skills` → `{ data: SkillSummary[] }`

```jsonc
{ "data": [
  { "id": "sk_default", "name": "Default", "description": "…",
    "model": "MiniMax-M2.7", "tenantId": "t_acme", "updatedAt": "2026-…Z" }
] }
```

#### `GET /skills/:id` → `{ data: SkillDetail }`

```jsonc
{ "data": {
  "id": "sk_default", "name": "Default", "description": "…",
  "systemPrompt": "…", "model": "MiniMax-M2.7", "temperature": 0.7,
  "maxTokens": 4096, "sourceUrl": null, "tenantId": "t_acme",
  "createdAt": "2026-…Z", "updatedAt": "2026-…Z",
  "files": [ { "path": "SKILL.md", "size": 128 } ]
} }
```

> System (global) skills additionally carry the additive runtime flags
> `isSystem` and `cloneable` on the detail wire (BaoBox#264). The element reads
> them defensively to render read-only + "Copy as my own"; they aren't part of
> the strict request schemas, so they never need a contract release to ride
> through.

#### `PATCH /skills/:id` → `{ data: SkillDetail }`

The Phase-1 single-field edit, unchanged. Body is **exactly one** editable field;
unknown keys (e.g. `id`, `tenantId`) are rejected with `400 validation_error`:

```jsonc
// request
{ "description": "Updated copy" }
// response: the updated SkillDetail (same shape as GET /skills/:id)
```

### Phase 2 — authoring (#259)

#### `POST /skills` → `{ data: SkillDetail }` (HTTP **201**)

Create a new, **tenant-owned** skill. `name` + `systemPrompt` are required; the
rest are optional. `.strict()` rejects unknown keys (no smuggling `id`/`tenantId`).
Tools are **not** set here — attach them afterward via the tool endpoints (so the
server's tool allowlist gates them).

```jsonc
// request
{
  "name": "Support Triage",
  "systemPrompt": "You triage inbound support tickets…",
  "description": "First-line classifier",
  "model": "MiniMax-M2.7",
  "temperature": 0.4,
  "maxTokens": 2048,
  "sourceUrl": "https://git.acme.test/skills/triage"   // optional
}
// response 201: the full SkillDetail of the created skill
```

#### `PUT /skills/:id` → `{ data: SkillDetail }`

Structural multi-field update — the authoring form saves the whole skill in one
call (vs. the Phase-1 single-field `PATCH`). Accepts **any subset** of editable
fields, requiring **at least one**; `.strict()` still rejects `id`/`tenantId`.

```jsonc
// request
{ "name": "Support Triage v2", "temperature": 0.3, "systemPrompt": "…" }
// response: the updated SkillDetail
```

#### `GET /skills/:id/attached-skills` → `{ data: SkillSummary[] }`

The orchestrator's directly-attached child skills (lean summaries).

#### `POST /skills/:id/attached-skills` → `{ data: { attached: true } }`

Attach a child skill to the parent (`:id`). A child that would close a cycle in
the graph is rejected with `422 cycle_detected`.

```jsonc
// request
{ "childSkillId": "sk_classifier" }
// response: { "data": { "attached": true } }
```

#### `DELETE /skills/:id/attached-skills/:childId` → `{ data: { detached: true } }`

#### `GET /skills/:id/tools` → `{ data: SkillToolSummary[] }`

The tools attached to the skill, **projected** to `{ id, name, description }`. The
SDK's full `Tool` carries `handlerConfig` / `inputSchema` (which may hold callback
secrets); those are dropped server-side and **never reach the browser**.

```jsonc
{ "data": [ { "id": "tool_search", "name": "Web Search", "description": "…" } ] }
```

#### `GET /tools` → `{ data: SkillToolSummary[] }` *(Phase 3 — #312)*

Returns the **attachable tool allowlist** for this tenant (own tools + global
tools visible to the tenant's credential). The response is the same lean
projection used by `GET /skills/:id/tools` — `{ id, name, description }` —
`handlerConfig` / `inputSchema` are dropped server-side and never reach the
browser.

```jsonc
{ "data": [
  { "id": "tl_search", "name": "Web Search", "description": "…" },
  { "id": "tl_calc",   "name": "Calculator",  "description": "…" }
] }
```

This endpoint is **distinct** from `GET /skills/:id/tools` (tools already
attached to a specific skill). The `authz` hook sees `op="listAvailableTools"`
with no `skillId` — the allowlist is tenant-level. The Web Component uses this
list to populate the tool-picker `<select>` (excluding already-attached tools),
falling back to attach-by-id free-text input if the call fails (e.g. the BFF
is on an older version without this endpoint). The server allowlist remains the
authority in both modes — `tool_not_allowed` is still surfaced on a bad attach.

#### `GET /models` → `{ providers, reasoningEfforts }` *(#320)*

Returns the live LLM model catalog — all providers and models BaoBox knows
about. The Web Component uses this to populate the model picker `<datalist>`
with the current server-side catalog, replacing the static fallback list.

**ADMIN_SECRET-gated**: the BFF calls `client.catalog.list()` on the SDK,
which requires an `adminSecret` credential. An `apiKey`-only BFF receives 401
and returns `upstream_error`; the Web Component falls back to the static
built-in catalog transparently. The catalog carries **no secrets** — it is
safe to return as-is to the browser.

```jsonc
{
  "providers": [
    {
      "id": "openai",
      "displayName": "OpenAI",
      "defaultModel": "openai/gpt-5",
      "docsUrl": "https://platform.openai.com/docs",
      "pricingUrl": "https://openai.com/pricing",
      "models": [
        { "id": "openai/gpt-5", "displayName": "GPT-5", "paramProfile": "reasoning",
          "reasoningEfforts": ["minimal","low","medium","high"], "contextWindow": 128000 },
        { "id": "openai/gpt-4o", "displayName": "GPT-4o", "paramProfile": "sampling" }
      ]
    }
  ],
  "reasoningEfforts": ["none","minimal","low","medium","high","xhigh"]
}
```

The `authz` hook sees `op="listModels"` with no `skillId` (catalog is
non-tenant). The response shape mirrors the SDK `LlmCatalog` type (also
declared in `@baobox/skill-builder-contract` as `ModelCatalogResponse`).

#### `GET /skills/:id/role-models` → `SkillRoleModelsMap` (#328)

Returns the full role → chain map for a skill. Requires `skills:read`. The
`authz` hook sees `op="getRoleModels"` with `skillId`. Response shape is
`Record<ModelRole, SkillRoleModel[]>` (re-exported from `@baobox/sdk` via the
contract as `SkillRoleModelsMap`).

```jsonc
// GET /skills/sk_abc/role-models
{
  "main": [],
  "preflight_guard": [
    { "skillId": "sk_abc", "role": "preflight_guard", "position": 0,
      "llmIntegrationId": null, "model": "openai/gpt-5", "llmSource": "pinned" }
  ],
  "postflight_guard": [],
  "eval_judge": []
}
```

#### `PUT /skills/:id/role-models` (body: `{ role, chain }`) → `{ role, chain }` (#328)

Replaces the model chain for **one role** on a skill. Requires `skills:write`.
The `authz` hook sees `op="putRoleModels"` with `skillId`. Chain is an ordered
array of up to 4 entries; an empty array clears the role (inherits tenant
default). In the Studio scope, `llmIntegrationId` may be `null` (catalog model, `llmSource: "pinned"`)
or an integration id returned by `GET /llm-integrations` (see #330 below).

```jsonc
// PUT /skills/sk_abc/role-models
// request body:
{
  "role": "preflight_guard",
  "chain": [
    { "llmIntegrationId": null, "model": "openai/gpt-5", "llmSource": "pinned" },
    { "llmIntegrationId": null, "model": "openai/gpt-4o", "llmSource": "pinned" }
  ]
}
// response: { "role": "preflight_guard", "chain": [...] }
// clear (inherit default):
{ "role": "preflight_guard", "chain": [] }
```

**Studio scope** — the "Per-role models & fallback" panel covers three roles:
- `preflight_guard` — PRIMARY + optional BACKUP model selects
- `postflight_guard` — PRIMARY + optional BACKUP model selects
- `main` — BACKUP only (its primary is the skill's main model configured in
  the main edit form)

`eval_judge` is not exposed in the Studio UI (judge configuration is a
platform-level concern). The BFF and contract types include it for API
completeness.

#### `GET /llm-integrations` → `{ data: LlmIntegration[] }` (#330)

Returns the tenant's configured LLM integrations. The `authz` hook sees
`op="listLlmIntegrations"` with `tenantId` only (no `skillId`). This is a
read-only, tenant-scoped call — the credential never leaves the BFF.

```ts
interface LlmIntegration {
  id: string;           // opaque integration id — pass as llmIntegrationId
  displayName: string;  // e.g. "OpenAI (tenant)"
  provider: string;     // e.g. "openai"
  defaultModel: string; // provider's default for this integration
  isDefault: boolean;   // true for the tenant's default integration
  apiKeyMask: string;   // last-4 of the API key, safe to display
}
```

An empty array (`[]`) means the tenant has no configured integrations — the
Studio falls back to the free-text catalog model input automatically.

#### `GET /llm-integrations/:id/models` → `IntegrationModelsViewResponse` (#330)

Returns the live model list for a specific integration. The `:id` is
URL-encoded. The `authz` hook sees `op="listIntegrationModels"` with `tenantId`.

```ts
interface IntegrationModelsViewResponse {
  integrationId: string;
  provider: string;
  models: IntegrationModel[];
  providerListError: string | null;  // non-null = provider API soft failure
}

interface IntegrationModel {
  id: string;
  displayName: string;
  source: string;          // "provider" | "catalog"
  paramProfile: string;    // "sampling" | "reasoning"
  reasoningEfforts: string[];
  pricing: unknown | null;
}
```

When `providerListError` is non-null the BFF returns HTTP 200 with an empty
`models` array and the error note; the Studio surfaces it as a soft warning so
the user can still type a model id manually.

**Integration-first save flow (#330):** When an integration is selected and a
model is chosen, `updateSkillStructural` (`PUT /skills/:id`) receives:

```jsonc
{
  "llmIntegrationId": "int_openai",   // the chosen integration id
  "model": "openai/gpt-4o",           // the chosen model id
  "llmSource": "pinned"               // always "pinned" when an integration is set
}
```

Clearing the integration (back to "Use tenant default") sends:

```jsonc
{
  "llmIntegrationId": null,
  "llmSource": "tenant_default"
}
```

#### `POST /skills/:id/tools` → `{ data: { attached: true } }`

Attach a tool by id. The server confines attach to the tenant key's `tool:<id>`
allowlist; an off-list (or not-visible) tool is rejected with `403
tool_not_allowed`. The `GET /tools` endpoint (above, Phase 3) lets the picker
offer only the allowlist; the server remains the final authority.

```jsonc
// request
{ "toolId": "tool_search" }
// response: { "data": { "attached": true } }
```

#### `DELETE /skills/:id/tools/:toolId` → `{ data: { detached: true } }`

#### `GET /skills/:id/parameters` → `{ data: SkillParameter[] }`

Per-tenant parameters for the skill. Secret values are **masked** (blanked) — the
browser only learns that a secret is set, never its value. Returns `[]` when no
parameter store is configured.

```jsonc
{ "data": [
  { "key": "account_id", "value": "acct_42", "label": "Account ID" },
  { "key": "api_token",  "value": "",        "label": "API token", "secret": true }
] }
```

#### `PUT /skills/:id/parameters` → `{ data: SkillParameter[] }`

Replace the full parameter set. `key` is `^[A-Za-z0-9_]+$`; `value` is a string;
`secret`/`label` are optional. The response echoes the stored set **with secrets
masked**. Refused with `403` when no parameter store is configured.

```jsonc
// request
{ "parameters": [
  { "key": "account_id", "value": "acct_99", "label": "Account ID" },
  { "key": "api_token",  "value": "",        "label": "API token", "secret": true }
] }
// response: the same list, secret values blanked
```

> **"Empty secret value = keep".** A `secret: true` row sent with an **empty
> `value`** means *keep the currently-stored secret* — because the UI never
> received the real value to resubmit (it was masked). See
> [Per-tenant parameters](#per-tenant-parameters) for the host-store contract.

### The error envelope & codes

Every non-2xx on this surface is:

```jsonc
{ "error": { "code": "<ContractErrorCode>", "message": "…", "requestId": "…" } }
```

`code` is one of a **stable enum**, so the Web Component branches on it rather
than parsing prose:

| `code` | HTTP | Meaning |
| ------ | ---- | ------- |
| `validation_error` | 400 | request body failed schema validation (or smuggled `id`/`tenantId`) |
| `cycle_detected` | 422 | a sub-skill attach would create a cycle in the graph |
| `tool_not_allowed` | 403 | the tool isn't on the tenant key's allowlist |
| `forbidden` | 403 | `authz` denied, or the resource isn't this tenant's |
| `not_found` | 404 | skill/child/tool not visible to this tenant (incl. cross-tenant) |
| `conflict` | 409 | duplicate / state conflict |
| `upstream_error` | 502 | BaoBox returned an unexpected error |
| `internal_error` | 500 | unhandled BFF error |

The BFF maps the worker's raw codes/statuses to these, with op-aware
disambiguation: a `403` on the tool-attach path becomes `tool_not_allowed`, and a
`422` on the sub-skill-attach path becomes `cycle_detected`. The credential is
**redacted from every field** of the error (code, message, requestId) as a
backstop.

---

## Tenant scoping (why this is safe)

The BFF passes your `tenantId` to BaoBox on every call, backed by the worker's
`X-BaoBox-Tenant-Id` scope (#247):

- **list / listAttachedSkills** return that tenant's skills **plus** global system
  skills — never another tenant's.
- **get / update / attach / detach** on a resource owned by another tenant returns
  **404** (not 403), so a caller can't even probe for its existence.
- **create** is always **tenant-owned** server-side (the per-tenant key enforces
  ownership; the contract carries no `tenantId` to forge).

Your `authz` hook is the second gate, in front of every BaoBox call — and the
BFF is **fail-closed**: with no `authz` hook, every request is denied (see
[Security](#security--supply-chain)).

### The key's grants (#257)

A per-tenant `apiKey` carries a `permissions` JSON array holding **three distinct
namespaces** (a value's shape says which namespace it's in, so they can't be
confused):

1. **Skill-id allowlist** — bare ids like `sk_abc` (the original chat-gate). No
   colon.
2. **Action grants** — `ns:verb`, e.g. `skills:read`, `skills:write`,
   `skills:create`, `skills:attach`, `skills:tools`. Unlike the skill-id
   allowlist, action grants are **never implicitly granted** — a key without
   `skills:create` cannot create, etc.
3. **Tool allowlist** — `tool:<toolId>` entries (#257) enumerate exactly which
   tools a key carrying `skills:tools` may attach to its own skills.

So to use the full authoring UI, a tenant key needs
`skills:read skills:write skills:create skills:attach skills:tools` plus a
`tool:<id>` entry for each tool the platform owner permits that tenant to attach.

### The tool allowlist — server-enforced, picker-supported

The allowlist lives on the key (namespace 3 above) and is enforced by the
worker: an off-list `attachTool` returns `403` → the BFF maps it to
`tool_not_allowed` → the element surfaces "that tool isn't permitted for your
tenant". This server-side enforcement is the **authority and safety net** in all
cases.

Phase 3 (#312) adds `GET /tools` (`listAvailableTools`) so the element can
**proactively** show the tenant's attachable tools in a `<select>` picker
(excluding already-attached tools). If that call fails (e.g. the BFF is on an
older version), the element silently falls back to the original attach-by-id
free-text input — the server guard still fires on every attach attempt.

To use the picker, the tenant key must carry `skills:tools`; the BFF calls
`client.tools.list()` (SDK `^0.16.0`) which returns tools visible to that key.
The `authz` hook sees `op="listAvailableTools"` — wire it like any other read op.

---

## The `onMutation` git-truth hook (#259)

Every structural mutation (create / update / structural-update / attach-detach
sub-skill / attach-detach tool / set-parameters) funnels through `authz` **before**
the write and fires `hooks.onMutation` **after** it commits in BaoBox.

It is a **notification, not a gate** — `authz` is the gate. The host uses it to
record the live edit as **drift** and queue a **promote-back** into its canonical
git store (e.g. NexionOps):

```ts
onMutation: async (event) => {
  // event: { op, tenantId, skillId, childSkillId?, toolId?, before?, after? }
  await driftQueue.enqueue(event);
}
```

- `op` is the `SkillStudioMutationOp` that fired it; `skillId` is the target.
- `before` / `after` carry the skill's pre-/post-image for the **field**
  mutations (`create` has no `before`; `update` / `updateStructural` carry both).
  For graph / tool / parameter ops the change isn't expressed on `SkillDetail`, so
  `before` / `after` are omitted and the `op` + target id (`childSkillId` /
  `toolId`) is the signal.
- **Best-effort:** the BaoBox write has already committed by the time this fires,
  so a throwing / rejecting `onMutation` **never fails the request** — the live
  state is authoritative and the failure is recorded via `audit` (as a
  `mutation_hook_failed` error outcome). Default: no-op (Phase-1 behaviour).

---

## Per-tenant parameters

Per-tenant parameters let a tenant parameterise a skill (an account id, a brand
name, a per-tenant secret reference) **without editing the prompt**. They have
**no BaoBox backing** — they are the **host's data** — so the BFF delegates
persistence to `hooks.parameters`:

```ts
parameters: {
  get: ({ tenantId, skillId }) => store.read(tenantId, skillId),   // SkillParameter[]
  set: (params, { tenantId, skillId }) => store.write(tenantId, skillId, params),
}
```

- Omit `hooks.parameters` and the route still exists but is inert: `GET` returns
  `[]` and `PUT` is **refused with 403** (rather than silently dropping a write).
- A parameter marked `secret: true` has its value **masked (blanked) in every
  response** — `GET` and the `PUT` echo. The store owns the cleartext; the browser
  never receives it.

### Convention the host store MUST honor: "empty secret value = keep"

Because secrets are masked on read, the UI never holds a secret's real value to
resubmit. So the element sends a `secret: true` row with an **empty `value`** to
mean **"keep the currently-stored secret unchanged."** Your `parameters.set`
implementation **must** honor this:

```ts
set(incoming, { tenantId, skillId }) {
  const existing = store.read(tenantId, skillId);
  const merged = incoming.map((p) => {
    if (p.secret && p.value === "") {
      // KEEP: retain the stored secret value; do NOT overwrite with blank.
      const prior = existing.find((e) => e.key === p.key);
      return prior ? { ...p, value: prior.value } : p;
    }
    return p; // non-secret, or a secret being set/rotated to a new value
  });
  store.write(tenantId, skillId, merged);
  return merged; // (BFF re-masks secrets before echoing)
}
```

If the store instead writes the blank through, **every save silently wipes secrets
the user didn't intend to change.** A non-empty `value` on a `secret` row *is* a
real rotation and should overwrite.

---

## Security & supply chain

The Web Component is **runtime-loaded into your admin origin** and runs with the
admin's session, so treat the bundle as code you ship. Required controls:

- **Pin the exact bundle version** — never float `@latest`. Pin
  `@baobox/skill-builder@0.2.0` (and ideally **self-host** the bundle from your
  own static origin rather than depending on a public CDN at runtime, or vendor
  it as a build-time dependency you bundle yourself).
- **Subresource Integrity (SRI)** when loading from a URL — add an `integrity`
  hash so a tampered/replaced bundle won't execute:
  ```html
  <script type="module"
          src="https://your-cdn/baobox-skill-builder-0.2.0.js"
          integrity="sha384-…"
          crossorigin="anonymous"></script>
  ```
  Generate the hash from the published artifact:
  `openssl dgst -sha384 -binary baobox-skill-builder.js | openssl base64 -A`.
- **Content-Security-Policy** on the admin page — restrict where the bundle may
  load from and where it may talk to. The element only needs to reach your BFF
  origin:
  ```
  Content-Security-Policy: script-src 'self' https://your-cdn;
                           connect-src 'self' https://your-bff-origin;
  ```
- **Provenance** — the packages are published with npm `--provenance` from the
  public `baobox-ai/baobox-skill-studio` repo (verifiable build attestation).
  Prefer installing the npm package over copy-pasting bundle contents.
- **Never put the credential (`apiKey` / `adminSecret`), BaoBox endpoint, or
  another tenant's id in client code** — those live only in the BFF
  (server-side). The browser holds **no BaoBox credentials**; the element never
  calls BaoBox.

### BFF-side guarantees

- **Fail-closed authz (default).** With **no `hooks.authz`**, every request is
  **denied (403)** and the BFF logs a warning at mount. To run without an authz
  hook you must explicitly set **`allowUnauthenticated: true`** — and only when
  another layer already authorizes callers.
- **Per-tenant credential (#254 AC1).** Prefer `apiKey` — a tenant-bound key. The
  credential itself enforces the tenant boundary, so a breached/buggy BFF can
  never reach another tenant's skills; the `X-BaoBox-Tenant-Id` scope is then
  belt-and-suspenders.
- The credential is held server-side and **never appears in any response or
  error** — error fields are mapped from the SDK's status/code and the credential
  is additionally redacted from every outgoing string as a backstop.
- **Tool list is projected** to `{ id, name, description }` — `handlerConfig` /
  `inputSchema` are dropped server-side and never reach the browser.
- **Secret parameters never leave the server** — `secret: true` values are blanked
  in every response.

> `apiKey` mode requires `@baobox/sdk` >= 0.16.0 and a BaoBox server with #257
> worker support (the tenant key carrying `skills:*` grants + the `tool:<id>`
> allowlist). The live model catalog (`GET /models`, #320) additionally requires
> `@baobox/sdk` >= 0.18.0 and an `adminSecret` credential on the BFF.

### How the BFF authenticates the user

The element fetches the BFF with `credentials: "same-origin"`: your **own**
tenant session (cookie/header) reaches your BFF when it's mounted on the **same
origin** as the host page (the recommended setup), so your `authz` hook can
identify the user — but **nothing** is sent cross-origin, and **never** to
BaoBox. If you mount the BFF on a **different origin**, same-origin cookies won't
be sent: authenticate those requests another way (e.g. a token your host adds)
and keep `authz` fail-closed.

---

## Definition of a working Phase-2 E2E

Tick all of these to confirm the full authoring integration is live:

- [ ] The element renders **inline** in your host page (no iframe) and lists
      **your tenant's** skills + global skills (none from other tenants).
- [ ] **+ New skill** creates a tenant-owned skill (`POST /skills` → 201) and it
      appears in the list.
- [ ] Editing the form and saving round-trips via **`PUT /skills/:id`** and shows
      “Saved ✓”; the single-field Phase-1 `PATCH` still works for legacy callers.
- [ ] Attaching a sub-skill works; attaching one that **would create a cycle**
      shows the cycle message (`cycle_detected`), not a generic error.
- [ ] Attaching an **allowlisted** tool works; an **off-allowlist** tool shows the
      "not permitted" message (`tool_not_allowed`).
- [ ] Setting parameters round-trips; a **secret** value is masked on reload, and
      re-saving **without** retyping it **keeps** the stored secret (empty-secret
      convention).
- [ ] A **system (global)** skill renders **read-only** with **“Copy as my own”**
      when cloneable (BaoBox#264).
- [ ] In devtools → Network: **every** request goes to your `api-base` — **zero**
      requests to the BaoBox origin.
- [ ] Each write produced an **audit record**; each committed structural mutation
      fired **`onMutation`**.
- [ ] A user your `authz` hook denies gets a **403** and no BaoBox call is made.

---

## Troubleshooting

- **Element shows “api-base is required”** — the `api-base` attribute is empty;
  set it to your BFF mount path. (The element refuses to fall back to the page
  origin.)
- **All Phase-2 actions 404** — your BFF/contract are still on Phase-1 (`0.1.x`).
  Upgrade to the compatibility set (sdk 0.16 / contract 0.2 / bff 0.3 / web 0.2).
- **401/403 from the BFF** — check your `authz` hook and that your credential is
  valid server-side. With an `apiKey`, a 403 also means the key lacks the action
  grant the op needs (`skills:create`/`skills:attach`/`skills:tools`) or isn't
  bound to this `tenantId`.
- **`tool_not_allowed` on a tool you expect** — the tool isn't on the key's
  `tool:<id>` allowlist (or isn't visible to this tenant). The allowlist is
  managed by the platform owner on the key. Use `GET /tools` (`listAvailableTools`)
  to see what the key currently grants — if a tool you expect is missing from
  that list, the platform owner needs to add the `tool:<id>` entry to the key.
- **`cycle_detected` on attach** — the child (transitively) already reaches the
  parent; attaching it would close a loop in the orchestrator graph.
- **Saving parameters wipes a secret** — your `parameters.set` isn't honoring the
  **"empty secret value = keep"** convention; retain the stored value when a
  `secret` row arrives with a blank `value` (see [Per-tenant parameters](#per-tenant-parameters)).
- **`PUT …/parameters` returns 403 but `authz` allowed it** — you haven't wired
  `hooks.parameters`; the parameter feature is disabled and writes are refused.
- **404 on a skill you expect** — it may belong to a different tenant, or your
  `tenantId` is wrong. Cross-tenant access is intentionally a 404.
- **Everything is denied (403)** — the BFF is fail-closed: you haven't wired an
  `authz` hook (or it can't see the session — check it's same-origin).

## What's next

Phase 2 completes the orchestrator authoring surface. Downstream:

- **NexionOps (#255)** consumes this compatibility set (sdk 0.16 / contract 0.2 /
  bff 0.3 / web 0.2), wiring the real `authz`, `audit`, `onMutation` (drift →
  promote-back) and `parameters` host store (honoring the empty-secret convention).
- **UAT (#262)** validates the end-to-end tenant authoring flow.
- **#330 (integration-first model picker)** — landed in contract 0.6.0 / bff 0.7.0 /
  web 0.6.0 (sdk ≥ 0.21.0). Hosts that configure `hooks.authz` to allow
  `listLlmIntegrations` and `listIntegrationModels` will surface the integration
  picker in the Studio. Hosts that deny or omit these ops get the free-text
  catalog fallback automatically.

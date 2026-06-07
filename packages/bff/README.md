# @baobox/skill-builder-bff

The **Backend-for-Frontend** for the BaoBox **Skill Studio**. A mountable
[Hono](https://hono.dev) router the tenant's own backend mounts; it is the only
thing that performs real BaoBox operations — **through `@baobox/sdk`**
(a per-tenant `apiKey`, or a legacy `adminSecret`), server-side, scoped to one
tenant.

The embedded `<baobox-skill-builder>` Web Component (`@baobox/skill-builder`,
#249) calls **this** router (never BaoBox). It implements the
`@baobox/skill-builder-contract` surface.

> Phase 1 (walking skeleton): **list skills · get one · update one field.**
> Phase 2 (#259): **create · structural edit · sub-skill graph · tool wiring ·
> per-tenant parameters**, plus the git-truth `onMutation` control point.

## Install

```sh
npm install @baobox/skill-builder-bff @baobox/sdk hono
# @baobox/skill-builder-contract comes in as a dependency
```

`@baobox/sdk@^0.16.0` is required (the tenant-scoped `skills.*` reads/writes from
#247 plus the #257 authoring ops: create / attach-sub-skill / attach-tool).
`hono` is a peer dependency — the BFF returns a Hono router you mount on your app.

## Mount (Hono / Cloudflare Workers)

```ts
import { Hono } from "hono";
import { createSkillBuilderBff } from "@baobox/skill-builder-bff";

const app = new Hono();

const skillStudio = createSkillBuilderBff({
  endpoint: env.BAOBOX_ENDPOINT,     // your BaoBox worker URL
  apiKey: env.BAOBOX_SKILLS_KEY,     // per-tenant key (recommended) — server-side only
  tenantId: "t_acme",                // every call is scoped to this tenant (#247)
  hooks: {
    authz: ({ op, skillId }) => currentUserMayEdit(op, skillId), // false → 403
    audit: (record) => auditLog.write(record),                   // best-effort
  },
});

app.route("/api/skill-studio", skillStudio);
// → point the element's `api-base` at "/api/skill-studio"
```

## Endpoints (the contract)

Relative to the mount path. Every call is scoped to `tenantId` via `@baobox/sdk`.

**Phase 1 — reads + single-field edit**

| Method & path       | Calls                                         | Returns                    |
| ------------------- | --------------------------------------------- | -------------------------- |
| `GET /skills`       | `skills.list({ tenantId })`                   | `{ data: SkillSummary[] }` |
| `GET /skills/:id`   | `skills.get(id, { tenantId })`                | `{ data: SkillDetail }`    |
| `PATCH /skills/:id` | `skills.update(id, body, { tenantId })` → get | `{ data: SkillDetail }`    |

**Phase 2 — authoring (#259)**

| Method & path                          | Calls                                  | Returns                       |
| -------------------------------------- | -------------------------------------- | ----------------------------- |
| `POST /skills`                         | `skills.create(body)` → get            | `{ data: SkillDetail }` (201) |
| `PUT /skills/:id`                      | `skills.update(id, body)` → get        | `{ data: SkillDetail }`       |
| `GET /skills/:id/attached-skills`      | `skills.listAttachedSkills(id)`        | `{ data: SkillSummary[] }`    |
| `POST /skills/:id/attached-skills`     | `skills.attachSkill(id, childSkillId)` | `{ data: { attached } }`      |
| `DELETE /skills/:id/attached-skills/:childId` | `skills.detachSkill(id, childId)` | `{ data: { detached } }`      |
| `GET /skills/:id/tools`                | `skills.listTools(id)` → projected     | `{ data: SkillToolSummary[] }`|
| `POST /skills/:id/tools`               | `skills.attachTool(id, toolId)`        | `{ data: { attached } }`      |
| `DELETE /skills/:id/tools/:toolId`     | `skills.detachTool(id, toolId)`        | `{ data: { detached } }`      |
| `GET /skills/:id/parameters`           | host `parameters.get` (masked)         | `{ data: SkillParameter[] }`  |
| `PUT /skills/:id/parameters`           | host `parameters.set` → masked echo    | `{ data: SkillParameter[] }`  |

Request bodies are validated by the matching contract schema (unknown keys like
`id`/`tenantId` rejected → `400 validation_error`). Non-2xx responses use the
contract's stable `{ error: { code, message, requestId? } }` envelope, where
`code` is one of the contract's `ContractErrorCode`s — e.g. a sub-skill cycle is
`cycle_detected` (422) and an off-allowlist tool is `tool_not_allowed` (403) — so
the Web Component can branch on `code` instead of parsing prose.

## Config & hooks

```ts
createSkillBuilderBff({
  endpoint: string,
  // EXACTLY ONE credential (server-side only):
  apiKey?: string,       // per-tenant key with skills:read/skills:write — RECOMMENDED (#254)
  adminSecret?: string,  // cross-tenant admin secret — legacy; reaches every tenant
  tenantId: string,
  hooks?: {
    authz?: (ctx: { op, tenantId, skillId?, childSkillId?, toolId? }) => boolean | void | Promise<…>,  // false/throw → 403
    audit?: (record: { op, tenantId, skillId?, childSkillId?, toolId?, outcome, updatedField?, updatedFields?, error? }) => void | Promise<…>,
    sourceOfTruth?: {                       // optional READ decorators; default off (BaoBox is source)
      list?:   (summaries, { tenantId }) => SkillSummary[] | Promise<…>,
      detail?: (detail, { tenantId, skillId }) => SkillDetail | Promise<…>,
    },
    onMutation?: (e: { op, tenantId, skillId, childSkillId?, toolId?, before?, after? }) => void | Promise<…>,  // git-truth (#259); best-effort; default no-op
    parameters?: {                          // per-tenant parameter store (#259); omit → params disabled
      get: ({ tenantId, skillId }) => SkillParameter[] | Promise<…>,
      set: (params, { tenantId, skillId }) => SkillParameter[] | void | Promise<…>,
    },
  },
  allowUnauthenticated?: boolean,  // default false — see "fail-closed" below
  client?: BaoBoxClient,   // inject a pre-built/stubbed client (tests)
  fetch?: typeof fetch,    // forwarded to the SDK client
})
```

Per request: **authz → SDK call → (onMutation, on writes) → audit → contract-shaped response.**

### `onMutation` — the git-truth control point (#259)

Every structural mutation (create / update / attach-detach sub-skill /
attach-detach tool / set-parameters) funnels through `authz` **before** the write
and fires `onMutation` **after** it commits. It is a *notification*, not a gate
(the gate is `authz`), so the host uses it to record the live edit as **drift**
and queue a **promote-back** into its canonical git store. `before`/`after` carry
the skill image for the field mutations; graph/tool/parameter ops carry the `op`
plus the target id. Because the BaoBox write has already committed, a throwing
`onMutation` never fails the request — the failure is recorded via `audit`.

### Per-tenant parameters

Per-tenant parameters have **no BaoBox backing** — they are the host's data — so
persistence is delegated to `hooks.parameters`. Omit it and `GET …/parameters`
returns `[]` while `PUT …/parameters` is refused (403). A parameter marked
`secret: true` has its value **masked (blanked) in every response**.

## Security

- **Fail-closed authz (default).** With **no `hooks.authz`**, every request is
  **denied (403)** and the BFF logs a warning at mount. To run without an authz
  hook you must explicitly set **`allowUnauthenticated: true`** — and only when
  another layer already authorizes callers (upstream middleware / trusted
  internal network). A forgotten hook can never silently expose skill read/write.
- **Per-tenant credential (#254 AC1).** Prefer `apiKey` — a tenant-bound BaoBox
  key carrying `skills:read` / `skills:write`. The credential itself enforces the
  tenant boundary, so a breached/buggy BFF can never reach another tenant's
  skills (the `X-BaoBox-Tenant-Id` scope becomes belt-and-suspenders). The legacy
  `adminSecret` is cross-tenant — only use it where a single shared credential is
  acceptable. Exactly one of `apiKey` / `adminSecret` is required.
- The credential is held server-side and **never appears in any response or
  error** — error messages are mapped from the SDK's status/code and the value
  (apiKey or adminSecret) is additionally redacted as a backstop.
- Every call is **tenant-scoped** (`#247`): a skill owned by another tenant
  returns **404**, never another tenant's data.
- `authz` denial short-circuits **before** any BaoBox call and returns **403**.
- **Tool list is projected** to `{ id, name, description }`. The SDK's full
  `Tool` carries `handlerConfig` / `inputSchema` (which may hold callback
  secrets); those are dropped server-side and **never reach the browser**.
- **Secret parameters never leave the server.** A `secret: true` parameter's
  value is blanked in every response (`GET` and the `PUT` echo).

> `apiKey` mode requires `@baobox/sdk` >= 0.16.0 and a BaoBox server with #257
> worker support (a tenant key carrying the `skills:*` grants + `tool:<id>`
> allowlist for the authoring routes).

## Versioning

`0.3.0`. Published from the `baobox-skill-studio` monorepo via a tag-driven
release (`bff-v*` → GitHub Actions → npm).

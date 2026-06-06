# @baobox/skill-builder-bff

The **Backend-for-Frontend** for the BaoBox **Skill Studio**. A mountable
[Hono](https://hono.dev) router the tenant's own backend mounts; it is the only
thing that performs real BaoBox operations — **through `@baobox/sdk`**
(adminSecret), server-side, scoped to one tenant.

The embedded `<baobox-skill-builder>` Web Component (`@baobox/skill-builder`,
#249) calls **this** router (never BaoBox). It implements the
`@baobox/skill-builder-contract` (#246) Phase-1 surface.

> Phase 1 (walking skeleton): **list skills · get one · update one field.**

## Install

```sh
npm install @baobox/skill-builder-bff @baobox/sdk hono
# @baobox/skill-builder-contract comes in as a dependency
```

`@baobox/sdk@^0.14.0` is required (the tenant-scoped `skills.*` from #247).
`hono` is a peer dependency — the BFF returns a Hono router you mount on your app.

## Mount (Hono / Cloudflare Workers)

```ts
import { Hono } from "hono";
import { createSkillBuilderBff } from "@baobox/skill-builder-bff";

const app = new Hono();

const skillStudio = createSkillBuilderBff({
  endpoint: env.BAOBOX_ENDPOINT,     // your BaoBox worker URL
  adminSecret: env.BAOBOX_ADMIN_SECRET, // stays server-side, never sent to the browser
  tenantId: "t_acme",                // every call is scoped to this tenant (#247)
  hooks: {
    authz: ({ op, skillId }) => currentUserMayEdit(op, skillId), // false → 403
    audit: (record) => auditLog.write(record),                   // best-effort
  },
});

app.route("/api/skill-studio", skillStudio);
// → point the element's `api-base` at "/api/skill-studio"
```

## Endpoints (the #246 contract)

Relative to the mount path:

| Method & path      | Calls (`@baobox/sdk`, scoped to `tenantId`)   | Returns                    |
| ------------------ | --------------------------------------------- | -------------------------- |
| `GET /skills`      | `skills.list({ tenantId })`                   | `{ data: SkillSummary[] }` |
| `GET /skills/:id`  | `skills.get(id, { tenantId })`                | `{ data: SkillDetail }`    |
| `PATCH /skills/:id`| `skills.update(id, body, { tenantId })` → get | `{ data: SkillDetail }`    |

`PATCH` validates the body with the contract's `skillUpdateRequestSchema`
(exactly one editable field; unknown keys like `id`/`tenantId` rejected → 400),
then re-fetches the detail so the response carries files.

## Config & hooks

```ts
createSkillBuilderBff({
  endpoint: string,
  adminSecret: string,
  tenantId: string,
  hooks?: {
    authz?: (ctx: { op, tenantId, skillId? }) => boolean | void | Promise<…>,  // false/throw → 403
    audit?: (record: { op, tenantId, skillId?, outcome, updatedField?, error? }) => void | Promise<…>,
    sourceOfTruth?: {                       // optional; default off (BaoBox is source)
      list?:   (summaries, { tenantId }) => SkillSummary[] | Promise<…>,
      detail?: (detail, { tenantId, skillId }) => SkillDetail | Promise<…>,
    },
  },
  client?: BaoBoxClient,   // inject a pre-built/stubbed client (tests)
  fetch?: typeof fetch,    // forwarded to the SDK client
})
```

Per request: **authz → SDK call → audit → contract-shaped response.**

## Security

- `adminSecret` is held server-side and **never appears in any response or
  error** — error messages are mapped from the SDK's status/code and the secret
  value is additionally redacted as a backstop.
- Every call is **tenant-scoped** (`#247`): a skill owned by another tenant
  returns **404**, never another tenant's data.
- `authz` denial short-circuits **before** any BaoBox call and returns **403**.

## Versioning

`0.1.0`. Published from the `baobox-skill-studio` monorepo via a tag-driven
release (`bff-v*` → GitHub Actions → npm).

# Skill Studio — tenant integration & onboarding

This guide is the contract a tenant follows to embed the BaoBox **Skill Studio**
(Phase 1). It is generic: nothing here is specific to any one tenant.

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
Your backend:  @baobox/skill-builder-bff  ──(adminSecret, tenant-scoped)──▶  BaoBox
                       via @baobox/sdk
```

## Packages & versions

| Package | Version | Where it runs | Role |
| ------- | ------- | ------------- | ---- |
| [`@baobox/sdk`](https://www.npmjs.com/package/@baobox/sdk) | `^0.14.0` | your backend | BaoBox HTTP client (tenant-scoped skills — #247) |
| [`@baobox/skill-builder-contract`](https://www.npmjs.com/package/@baobox/skill-builder-contract) | `^0.1.0` | both | shared BFF↔MFE HTTP contract (types + Zod) |
| [`@baobox/skill-builder-bff`](https://www.npmjs.com/package/@baobox/skill-builder-bff) | `^0.1.0` | your backend | mountable Hono BFF router |
| [`@baobox/skill-builder`](https://www.npmjs.com/package/@baobox/skill-builder) | `^0.1.0` | browser | `<baobox-skill-builder>` Web Component |

> Phase 1 = walking skeleton: **list skills · open one · edit one field.** No
> create wizard, sub-skills, or tools yet (Phase 2).

## Prerequisites

- A BaoBox **endpoint** URL and an **`adminSecret`** for your environment.
- Your **`tenantId`** (the BaoBox tenant this app acts as).
- A backend that can mount a [Hono](https://hono.dev) router (Phase-1 reference
  runtime: Hono on Cloudflare Workers). Other runtimes can wrap the router with a
  Hono adapter.

Keep the `adminSecret` **server-side only** — it must never reach the browser.

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
  adminSecret: env.BAOBOX_ADMIN_SECRET, // server-side only
  tenantId: "t_your_tenant",            // every call is scoped to this tenant (#247)
  hooks: {
    // REQUIRED in practice — the BFF is FAIL-CLOSED: with no authz hook every
    // request is denied (403). Wire this to YOUR session/permission model.
    // (To run without one — only behind another auth layer — set
    // `allowUnauthenticated: true` at the top level instead of a hook.)
    authz: ({ op, skillId }) => currentUserMayEdit(op, skillId),
    // Best-effort; a throw here never fails the request.
    audit: (record) => auditLog.write(record),
  },
});

// Mount under any base path. Remember this path — the element's `api-base`.
app.route("/api/skill-studio", skillStudio);
```

That's the entire backend surface. The BFF builds an `@baobox/sdk` client from
`{ endpoint, adminSecret }` and calls `skills.list/get/update` **scoped to
`tenantId`** — it never hand-rolls HTTP, and the `adminSecret` never appears in
any response or error.

### Config & hooks

```ts
createSkillBuilderBff({
  endpoint: string,
  adminSecret: string,
  tenantId: string,
  hooks?: {
    authz?: (ctx: { op: "list"|"get"|"update"; tenantId: string; skillId?: string })
              => boolean | void | Promise<boolean | void>,   // false/throw → 403
    audit?: (record: { op; tenantId; skillId?; outcome: "allowed"|"denied"|"error";
                       updatedField?; error?: { status; code } }) => void | Promise<void>,
    sourceOfTruth?: {                                          // optional; default off
      list?:   (summaries, { tenantId }) => SkillSummary[] | Promise<SkillSummary[]>,
      detail?: (detail, { tenantId, skillId }) => SkillDetail | Promise<SkillDetail>,
    },
  },
})
```

Per request the BFF runs **authz → SDK call → audit → contract-shaped response.**
(`createSkillBuilderBff` also accepts `client?` and `fetch?` for injecting a
pre-built/stubbed `@baobox/sdk` client in tests — not needed in production.)

---

## Step 2 — Embed the Web Component

Load the standalone bundle (Preact inlined, self-registers) from a **stable,
versioned URL** you control or a CDN, and drop the element in, pointing
`api-base` at the path where you mounted the BFF:

```html
<script type="module"
        src="https://unpkg.com/@baobox/skill-builder@0.1.0/dist/standalone/baobox-skill-builder.js"></script>

<baobox-skill-builder api-base="/api/skill-studio" theme="light"></baobox-skill-builder>
```

| Attribute  | Required | Notes                                   |
| ---------- | -------- | --------------------------------------- |
| `api-base` | yes      | The BFF mount path from Step 1.         |
| `theme`    | no       | `"light"` (default) or `"dark"`.        |

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

---

## The HTTP contract (BFF ↔ MFE)

The element calls these on `api-base`. Shapes come from
`@baobox/skill-builder-contract` and reuse `@baobox/sdk`'s skill types.

### `GET /skills` → `{ data: SkillSummary[] }`

```jsonc
{ "data": [
  { "id": "sk_default", "name": "Default", "description": "…",
    "model": "MiniMax-M2.7", "tenantId": "t_acme", "updatedAt": "2026-…Z" }
] }
```

### `GET /skills/:id` → `{ data: SkillDetail }`

```jsonc
{ "data": {
  "id": "sk_default", "name": "Default", "description": "…",
  "systemPrompt": "…", "model": "MiniMax-M2.7", "temperature": 0.7,
  "maxTokens": 4096, "sourceUrl": null, "tenantId": "t_acme",
  "createdAt": "2026-…Z", "updatedAt": "2026-…Z",
  "files": [ { "path": "SKILL.md", "size": 128 } ]
} }
```

### `PATCH /skills/:id` → `{ data: SkillDetail }`

Body is **exactly one** editable field (Phase 1 is single-field); unknown keys
(e.g. `id`, `tenantId`) are rejected with `400`:

```jsonc
// request
{ "description": "Updated copy" }
// response: the updated SkillDetail (same shape as GET /skills/:id)
```

Errors are `{ "error": { "code": string, "message": string, "requestId"?: string } }`
with the appropriate status (`400` invalid body, `403` authz denied, `404`
unknown/cross-tenant skill).

---

## Tenant scoping (why this is safe)

The BFF passes your `tenantId` to BaoBox on every call — `@baobox/sdk`'s
`skills.list({ tenantId })`, `skills.get(id, { tenantId })`, and
`skills.update(id, req, { tenantId })`, backed by the worker's
`X-BaoBox-Tenant-Id` scope (#247):

- **list** returns that tenant's skills **plus** global system skills — never
  another tenant's.
- **get/update** on a skill owned by another tenant returns **404** (not 403), so
  a caller can't even probe for its existence.

Your `authz` hook is the second gate, in front of every BaoBox call — and the
BFF is **fail-closed**: with no `authz` hook, every request is denied (see
Step 1).

---

## Security & supply chain

The Web Component is **runtime-loaded into your admin origin** and runs with the
admin's session, so treat the bundle as code you ship. Required controls:

- **Pin the exact bundle version** — never float `@latest`. Pin
  `@baobox/skill-builder@0.1.0` (and ideally **self-host** the bundle from your
  own static origin rather than depending on a public CDN at runtime, or vendor
  it as a build-time dependency you bundle yourself).
- **Subresource Integrity (SRI)** when loading from a URL — add an `integrity`
  hash so a tampered/replaced bundle won't execute:
  ```html
  <script type="module"
          src="https://your-cdn/baobox-skill-builder-0.1.0.js"
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
- **Never put the `adminSecret`, BaoBox endpoint, or another tenant's id in
  client code** — those live only in the BFF (server-side). The browser holds
  **no BaoBox credentials**; the element never calls BaoBox.

### How the BFF authenticates the user

The element fetches the BFF with `credentials: "same-origin"`: your **own**
tenant session (cookie/header) reaches your BFF when it's mounted on the **same
origin** as the host page (the recommended setup), so your `authz` hook can
identify the user — but **nothing** is sent cross-origin, and **never** to
BaoBox. If you mount the BFF on a **different origin**, same-origin cookies won't
be sent: authenticate those requests another way (e.g. a token your host adds)
and keep `authz` fail-closed.

### Multi-tenant / production gate (#254)

Phase-1 scoping uses the **cross-tenant `adminSecret`** plus the
`X-BaoBox-Tenant-Id` header the SDK sends — acceptable for a **single-tenant
staging** walking skeleton. **Before a second tenant or production**, the BFF
must authenticate with a **per-tenant credential** (so the key itself enforces
the boundary, with the header as belt-and-suspenders), and the fail-closed authz
above must be in force. These items are tracked as a pre-prod gate in
[baobox#254](https://github.com/baobox-ai/baobox/issues/254).

---

## Definition of a working Phase-1 E2E

Tick all of these to confirm the integration is live (mirrors the Epic's walking
skeleton):

- [ ] The element renders **inline** in your host page (no iframe).
- [ ] It lists **your tenant's** skills + global skills (and none from other
      tenants).
- [ ] Opening a skill shows its detail; editing the **description** and saving
      round-trips and shows “Saved ✓”.
- [ ] In browser devtools → Network: **every** request goes to your `api-base`
      (your backend) — **zero** requests to the BaoBox origin, **no** cookies on
      them.
- [ ] The single write produced an **audit record** via your `audit` hook.
- [ ] A user your `authz` hook denies gets a **403** and no BaoBox call is made.

---

## Troubleshooting

- **Element shows “api-base is required”** — the `api-base` attribute is empty;
  set it to your BFF mount path. (The element refuses to fall back to the page
  origin.)
- **401/403 from the BFF** — check your `authz` hook and that `adminSecret` is
  valid server-side. The `adminSecret` is never sent to the browser; don't put
  it in client config.
- **404 on a skill you expect** — it may belong to a different tenant, or your
  `tenantId` is wrong. Cross-tenant access is intentionally a 404.
- **CORS / auth** — serve the BFF on the **same origin** as the host page
  (recommended): the element's `same-origin` requests carry your tenant session
  for `authz`, no CORS needed. If you must mount it cross-origin, configure CORS
  **and** a non-cookie auth path (same-origin cookies aren't sent cross-origin).
- **Everything is denied (403)** — the BFF is fail-closed: you haven't wired an
  `authz` hook (or your hook can't see the session — check it's same-origin).

## Phase 2 (not yet)

Create wizard, sub-skill graph + attach/detach, tool attach, deeper theming, and
per-tenant parameterization are out of scope for Phase 1.

# @baobox/skill-builder

The framework-agnostic **`<baobox-skill-builder>` Web Component** for the BaoBox
**Skill Studio** — the embeddable MFE half of Epic baobox#244.

It renders the Phase-1 slice (**list skills · open one · edit one field**) and
reads ALL data from a configurable **`api-base`** — the tenant's own BFF
(`@baobox/skill-builder-bff`, #248) — via the `@baobox/skill-builder-contract`
(#246). It **never** talks to BaoBox, holds **no** cookie/session, and never
imports `@baobox/sdk`.

> Phase 1 (walking skeleton). No create wizard, sub-skills, or tools yet (Phase 2).

## Use it (any stack)

Load the prebuilt standalone bundle (Preact inlined, self-registers) and drop in
the element:

```html
<script type="module" src="https://unpkg.com/@baobox/skill-builder/dist/standalone/baobox-skill-builder.js"></script>

<baobox-skill-builder api-base="/api/skill-studio" theme="light"></baobox-skill-builder>
```

Attributes:

| Attribute  | Required | Notes                                            |
| ---------- | -------- | ------------------------------------------------ |
| `api-base` | yes      | Base URL of the tenant BFF (where #248 is mounted). |
| `theme`    | no       | `"light"` (default) or `"dark"`.                 |

> Host the bundle wherever you serve static assets (CDN or your app) at a
> **stable, versioned URL** — pin the version so a tenant upgrade is deliberate.

## Use it (npm / bundler)

```ts
import { registerSkillBuilder } from "@baobox/skill-builder";
registerSkillBuilder(); // defines <baobox-skill-builder>
```

### React host

```tsx
import { SkillBuilder } from "@baobox/skill-builder/react";

<SkillBuilder apiBase="/api/skill-studio" theme="light" />;
```

The React wrapper registers the element on import and renders the tag with the
right attributes.

### Programmatic / testing

```ts
import { createApi, SkillStudio } from "@baobox/skill-builder";
const api = createApi("/api/skill-studio"); // contract-typed client, no cookies
```

## How it talks to the BFF

All requests go to `api-base` using the #246 contract, with **no**
`credentials: "include"` — the BFF is the auth boundary:

| Element action | Request                  |
| -------------- | ------------------------ |
| load list      | `GET {api-base}/skills`  |
| open a skill   | `GET {api-base}/skills/:id` |
| save the field | `PATCH {api-base}/skills/:id` (single field) |

## Local dev (mock BFF, no backend)

```sh
npm run dev   # serves the harness; the element runs against an in-memory mock BFF
```

The harness (`dev/`) patches `fetch` with `createMockFetch()` so the element
renders list/detail/edit with no live backend.

## Build outputs

`npm run build` produces:
- `dist/index.js` + `.d.ts` — npm entry (`registerSkillBuilder`, `SkillStudio`, `createApi`).
- `dist/react.js` — the React wrapper (`@baobox/skill-builder/react`).
- `dist/standalone/baobox-skill-builder.js` — the **self-contained** bundle
  (Preact inlined) for `<script type="module">`.

## Versioning

`0.1.0`. Published from the `baobox-skill-studio` monorepo via a tag-driven
release (`web-v*` → GitHub Actions → npm).

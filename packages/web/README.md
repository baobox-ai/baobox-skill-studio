# @baobox/skill-builder

The framework-agnostic **`<baobox-skill-builder>` Web Component** for the BaoBox
**Skill Studio** — the embeddable MFE half of Epic baobox#244.

It renders the **full orchestrator authoring** surface — list · create · edit ·
sub-skill graph · tools · per-tenant parameters — and reads ALL data from a
configurable **`api-base`** — the tenant's own BFF (`@baobox/skill-builder-bff`)
— via the `@baobox/skill-builder-contract`. It **never** talks to BaoBox, holds
**no** cookie/session, and never imports `@baobox/sdk`.

> Phase 2 (#260): create-skill wizard, structural edit, sub-skill DAG with
> cycle-rejection UX, tool attach/detach, per-tenant parameters, CSS-custom-property
> theming, and read-only/"Copy as my own" for system skills (BaoBox#264).

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
| `api-base` | yes      | Base URL of the tenant BFF (where the BFF is mounted). |
| `theme`    | no       | `"light"` (default) or `"dark"`.                 |

> Host the bundle wherever you serve static assets (CDN or your app) at a
> **stable, versioned URL** — pin the version so a tenant upgrade is deliberate.

### Theming (brand tokens)

Colors are **CSS custom properties** on the element, so a host page brands it
from its own CSS — no internals, no rebuild:

```css
baobox-skill-builder {
  --bb-accent: #e11d48;
  --bb-radius: 12px;
  --bb-bg: #fffaf5;
}
```

Available tokens: `--bb-bg`, `--bb-fg`, `--bb-muted`, `--bb-border`,
`--bb-accent`, `--bb-accent-fg`, `--bb-card`, `--bb-danger`, `--bb-success`,
`--bb-radius`, `--bb-font`. The `theme="dark"` attribute swaps the built-in
defaults; a host rule overrides either.

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

All requests go to `api-base` using the #246 contract with
`credentials: "same-origin"` — the host's tenant session reaches a same-origin
BFF (so its `authz` hook can identify the user), but nothing is sent
cross-origin and the element never calls BaoBox. The BFF is the auth boundary:

| Element action | Request                  |
| -------------- | ------------------------ |
| load list      | `GET {api-base}/skills`  |
| open a skill   | `GET {api-base}/skills/:id` |
| create a skill | `POST {api-base}/skills` |
| save edits     | `PUT {api-base}/skills/:id` (structural, changed fields) |
| sub-skills     | `GET/POST {api-base}/skills/:id/attached-skills`, `DELETE …/:childId` |
| tools          | `GET/POST {api-base}/skills/:id/tools`, `DELETE …/:toolId` |
| parameters     | `GET/PUT {api-base}/skills/:id/parameters` |

A non-2xx carries the contract's stable `{ error: { code } }`; the UI branches on
`code` (e.g. `cycle_detected` → a graph-cycle message, `tool_not_allowed` → an
allowlist message). The off-allowlist guard is enforced **server-side** — the BFF
is the authority on which tools a tenant may attach.

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

`0.2.0`. Published from the `baobox-skill-studio` monorepo via a tag-driven
release (`web-v*` → GitHub Actions → npm).

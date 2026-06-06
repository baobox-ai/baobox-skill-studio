# Changelog

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

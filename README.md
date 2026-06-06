# baobox-skill-studio

An **embeddable Skill Studio** for [BaoBox](https://github.com/baobox-ai/baobox)
tenants — a Micro-Frontend (MFE) + Backend-for-Frontend (BFF) design built on
top of the published [`@baobox/sdk`](https://www.npmjs.com/package/@baobox/sdk).

Two platform rules drive the architecture:

1. A tenant's **browser never calls BaoBox directly.**
2. The tenant's **own backend** (holding its BaoBox credential) performs all
   real operations.

## Packages (Phase 1 — Epic baobox#244)

| Package | What it is | Ticket |
| ------- | ---------- | ------ |
| `@baobox/skill-builder-contract` | Shared BFF↔MFE HTTP contract (types + Zod) | #246 |
| `@baobox/skill-builder-bff` | Mountable BFF router wrapping `@baobox/sdk` | #248 |
| `@baobox/skill-builder` | `<baobox-skill-builder>` Web Component | #249 |

npm workspaces; each package publishes independently via a tag-driven release
(`<pkg>-v<semver>` → GitHub Actions → npm), mirroring `@baobox/sdk`.

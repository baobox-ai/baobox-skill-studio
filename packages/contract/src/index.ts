// @baobox/skill-builder-contract — the shared BFF↔MFE HTTP contract for the
// BaoBox Skill Studio (Phase 1: list skills, get one, update one field).
//
// Reuses `@baobox/sdk`'s skill types for payloads (re-exported below) so the
// backend SDK (#248) and the Web Component (#249) share one source of truth.
export * from "./skills.js";
export * from "./routes.js";

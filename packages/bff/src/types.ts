import type { BaoBoxClient } from "@baobox/sdk";
import type { SkillDetail, SkillParameter, SkillSummary } from "@baobox/skill-builder-contract";

// ---------------------------------------------------------------------------
// Operations the BFF mediates. Split into READ ops (no BaoBox state change) and
// MUTATION ops (a structural write that the host's git source-of-truth may want
// to record). Every op — read or write — funnels through `authz` first.
// ---------------------------------------------------------------------------

/** Reads — never change BaoBox state. */
export type SkillStudioReadOp =
  | "list"
  | "get"
  | "listAttachedSkills"
  | "listTools"
  | "getParameters";

/**
 * Structural mutations. Each one funnels through `authz` (before the write) and,
 * on success, the `onMutation` hook (after the write) so the tenant's git
 * source-of-truth can record drift / queue a promote-back (#259).
 */
export type SkillStudioMutationOp =
  | "create"
  | "update" // Phase-1 single-field PATCH
  | "updateStructural" // Phase-2 multi-field PUT
  | "attachSkill"
  | "detachSkill"
  | "attachTool"
  | "detachTool"
  | "setParameters";

export type SkillStudioOp = SkillStudioReadOp | SkillStudioMutationOp;

/**
 * Passed to the `authz` hook before every BaoBox call. The host decides whether
 * the current request may perform `op` for `tenantId`, optionally on a specific
 * `skillId` (the parent for graph/tool ops) and `childSkillId` / `toolId` target
 * (populated for the detach paths, where the target is in the URL). Return
 * `false` (or throw) to deny → the BFF responds 403 and never calls BaoBox.
 */
export interface AuthzContext {
  op: SkillStudioOp;
  tenantId: string;
  skillId?: string;
  /** The child skill being detached (`detachSkill`). */
  childSkillId?: string;
  /** The tool being detached (`detachTool`). */
  toolId?: string;
}

/**
 * Passed to the `audit` hook after each request resolves (allowed, denied, or
 * errored). Auditing is best-effort: a throwing `audit` hook never fails the
 * request. `updatedField` names the single field a Phase-1 PATCH changed;
 * `updatedFields` lists the fields a Phase-2 structural PUT changed.
 */
export interface AuditRecord {
  op: SkillStudioOp;
  tenantId: string;
  skillId?: string;
  childSkillId?: string;
  toolId?: string;
  outcome: "allowed" | "denied" | "error";
  updatedField?: string;
  updatedFields?: string[];
  error?: { status: number; code: string };
}

/**
 * The git-truth control point (#259). Fired AFTER a structural mutation commits
 * in BaoBox, so the host can record the live edit as drift and queue a
 * promote-back into its canonical git store (NexionOps). It is a notification,
 * NOT a gate — the gate is `authz`, which runs *before* the write. Because the
 * BaoBox write has already committed by the time this fires, a throwing/rejecting
 * `onMutation` never fails the request (the live state is authoritative); the
 * failure is surfaced through `audit` instead. Default: no-op (Phase-1 behaviour).
 *
 * `before` / `after` carry the skill's pre-/post-image for the field mutations
 * (`create` has no `before`; `update` / `updateStructural` carry both). For the
 * graph/tool/parameter ops the structural change isn't expressed on `SkillDetail`,
 * so `before` / `after` are omitted and the `op` + target id (`childSkillId` /
 * `toolId`) is the signal.
 */
export interface SkillMutationEvent {
  op: SkillStudioMutationOp;
  tenantId: string;
  skillId: string;
  childSkillId?: string;
  toolId?: string;
  before?: SkillDetail;
  after?: SkillDetail;
}

/**
 * Per-tenant parameter store (#259). Per-tenant parameters have no BaoBox
 * backing — they are the HOST's data — so the BFF delegates persistence here.
 * Provide it to enable the parameter endpoints; omit it and `GET .../parameters`
 * returns an empty list while `PUT .../parameters` is refused (403). The store
 * owns cleartext secret values; the BFF masks any `secret: true` value before it
 * leaves the server (it is never echoed to the browser).
 */
export interface ParameterStore {
  get: (ctx: {
    tenantId: string;
    skillId: string;
  }) => SkillParameter[] | Promise<SkillParameter[]>;
  /**
   * Persist the parameter set. Return the canonical stored list to echo it back
   * (after masking), or return `void` and the BFF echoes the validated input.
   */
  set: (
    parameters: SkillParameter[],
    ctx: { tenantId: string; skillId: string },
  ) => SkillParameter[] | void | Promise<SkillParameter[] | void>;
}

/**
 * Optional source-of-truth READ overrides for tenants whose canonical skill
 * metadata lives outside BaoBox. The BFF calls these to decorate/replace what it
 * returns after the SDK read. (The WRITE counterpart is `onMutation`.) Default:
 * undefined (BaoBox is the source).
 */
export interface SourceOfTruthHooks {
  list?: (
    skills: SkillSummary[],
    ctx: { tenantId: string },
  ) => SkillSummary[] | Promise<SkillSummary[]>;
  detail?: (
    skill: SkillDetail,
    ctx: { tenantId: string; skillId: string },
  ) => SkillDetail | Promise<SkillDetail>;
}

/** Pluggable per-request policy. All hooks are optional with safe no-op defaults. */
export interface SkillStudioHooks {
  /** Deny by returning `false` or throwing. Allow by returning `true`/`undefined`. */
  authz?: (ctx: AuthzContext) => boolean | void | Promise<boolean | void>;
  /** Best-effort audit sink; never fails the request. */
  audit?: (record: AuditRecord) => void | Promise<void>;
  /** Canonical-store READ overrides (decorate list/detail). Default off. */
  sourceOfTruth?: SourceOfTruthHooks;
  /**
   * Git-truth WRITE control point (#259) — fired after a structural mutation
   * commits. Best-effort (never fails the request). Default: no-op.
   */
  onMutation?: (event: SkillMutationEvent) => void | Promise<void>;
  /** Per-tenant parameter store (#259). Omit to disable the parameter endpoints. */
  parameters?: ParameterStore;
}

/**
 * Config for `createSkillBuilderBff`. The BFF builds a `@baobox/sdk` client and
 * scopes every call to `tenantId` (#247). The credential lives here,
 * server-side only — it is never echoed in any response or error.
 *
 * Provide EXACTLY ONE of `apiKey` (recommended) or `adminSecret`.
 */
export interface SkillStudioBffConfig {
  endpoint: string;
  /**
   * Per-tenant BaoBox API key (#254 AC1 — RECOMMENDED). A tenant-bound key
   * carrying the `skills:*` grants (read/write and, for Phase-2 authoring,
   * `skills:create` / `skills:attach` / `skills:tools` plus the `tool:<id>`
   * allowlist — #257). The credential itself enforces the tenant boundary, so
   * this BFF can never reach another tenant's skills (the `tenantId` scope
   * becomes belt-and-suspenders). Requires `@baobox/sdk` >= 0.16.0 and a BaoBox
   * server with #257 worker support.
   */
  apiKey?: string;
  /**
   * Cross-tenant BaoBox admin secret (legacy). Functional, but it can reach
   * EVERY tenant's skills — a breached BFF exposes them all. Prefer `apiKey`.
   */
  adminSecret?: string;
  tenantId: string;
  hooks?: SkillStudioHooks;
  /**
   * Fail-closed default (#254). With no `hooks.authz`, every request is DENIED
   * (403) unless this is explicitly `true`. Set it ONLY when another layer
   * already authenticates/authorizes requests reaching this router (e.g. an
   * upstream auth middleware or a trusted internal network). Default: `false` —
   * a forgotten `authz` hook must never silently expose skill read/write.
   */
  allowUnauthenticated?: boolean;
  /** Inject a pre-built / stubbed client (tests, custom transports). */
  client?: BaoBoxClient;
  /** `fetch` override forwarded to the SDK client (edge runtimes, tests). */
  fetch?: typeof globalThis.fetch;
}

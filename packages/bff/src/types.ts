import type { BaoBoxClient } from "@baobox/sdk";
import type { SkillDetail, SkillSummary } from "@baobox/skill-builder-contract";

/** The Phase-1 operations the BFF mediates. */
export type SkillStudioOp = "list" | "get" | "update";

/**
 * Passed to the `authz` hook before every BaoBox call. The host decides whether
 * the current request may perform `op` (optionally on `skillId`) for `tenantId`.
 * Return `false` (or throw) to deny → the BFF responds 403 and never calls
 * BaoBox.
 */
export interface AuthzContext {
  op: SkillStudioOp;
  tenantId: string;
  skillId?: string;
}

/**
 * Passed to the `audit` hook after each request resolves (allowed, denied, or
 * errored). Auditing is best-effort: a throwing `audit` hook never fails the
 * request. For `update`, `updatedField` names the single field that changed.
 */
export interface AuditRecord {
  op: SkillStudioOp;
  tenantId: string;
  skillId?: string;
  outcome: "allowed" | "denied" | "error";
  updatedField?: string;
  error?: { status: number; code: string };
}

/**
 * Optional source-of-truth overrides for tenants whose canonical skill metadata
 * lives outside BaoBox. Phase-1 default: undefined (BaoBox is the source). The
 * BFF calls these to decorate/replace what it returns after the SDK call.
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
  /** Optional canonical-store overrides (Phase 2 territory; default off). */
  sourceOfTruth?: SourceOfTruthHooks;
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
   * carrying `skills:read` / `skills:write`. The credential itself enforces the
   * tenant boundary, so this BFF can never reach another tenant's skills (the
   * `tenantId` scope becomes belt-and-suspenders). Requires `@baobox/sdk`
   * >= 0.15.0 and a BaoBox server with #254 worker support.
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

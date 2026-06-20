import { BaoBoxClient, BaoBoxError } from "@baobox/sdk";
import {
  type ContractErrorCode,
  contractErrorCodeSchema,
  type SkillDetail,
  type SkillParameter,
  type SkillSummary,
  type SkillToolSummary,
  type SkillWithFiles,
  attachSubSkillRequestSchema,
  attachToolRequestSchema,
  putRoleModelsRequestSchema,
  setSkillParametersRequestSchema,
  skillCreateRequestSchema,
  skillStructuralUpdateRequestSchema,
  skillUpdateRequestSchema,
  toSkillSummary,
} from "@baobox/skill-builder-contract";
// #330 — LlmIntegration / IntegrationModelsView are SDK types re-exported from
// the contract; import directly for BFF response typing.
import type { IntegrationModelsView, LlmIntegration } from "@baobox/sdk";
import { type Context, Hono } from "hono";
import type {
  AuditRecord,
  ParameterStore,
  SkillMutationEvent,
  SkillStudioBffConfig,
  SkillStudioHooks,
  SkillStudioMutationOp,
  SkillStudioOp,
} from "./types.js";

export type {
  AuditRecord,
  AuthzContext,
  ParameterStore,
  SkillMutationEvent,
  SkillStudioBffConfig,
  SkillStudioHooks,
  SkillStudioMutationOp,
  SkillStudioOp,
  SkillStudioReadOp,
  SourceOfTruthHooks,
} from "./types.js";

// Internal signal that the `authz` hook denied the request. Mapped to a clean
// 403 by `respondError` — distinct from an upstream BaoBox error.
class AuthzDenied extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthzDenied";
  }
}

interface ContractError {
  status: number;
  code: ContractErrorCode;
  message: string;
  requestId?: string;
}

const CONTRACT_CODES = new Set(contractErrorCodeSchema.options as readonly string[]);

// Normalize an upstream BaoBox error code/status to the STABLE contract code the
// Web Component branches on (#258). The worker's own codes (`skill_not_found`,
// `tool_not_found`, …) are NOT contract codes, so they're mapped by status. A
// few cases are disambiguated by the current `op`: a 403 on `attachTool` is the
// per-key tool allowlist rejection (`tool_not_allowed`), and a 422 on
// `attachSkill` is the sub-skill cycle guard (`cycle_detected`). When the worker
// already speaks a contract code (e.g. it returns `cycle_detected` directly),
// that's honored verbatim.
function normalizeContractCode(
  rawCode: string | undefined,
  status: number,
  op?: SkillStudioOp,
): ContractErrorCode {
  // op-specific disambiguation takes PRECEDENCE: the worker returns a generic
  // code on these paths (a plain `forbidden` for the tool-allowlist 403), so the
  // contract's specific code can only be recovered from the op + status. The only
  // BaoBox 403 on the tool-attach path is the allowlist/ownership rejection, and
  // the only 422 on the sub-skill attach path is the cycle guard.
  if (op === "attachTool" && status === 403) return "tool_not_allowed";
  if (op === "attachSkill" && status === 422) return "cycle_detected";
  // Otherwise honor a worker code that already speaks the contract verbatim…
  if (rawCode && CONTRACT_CODES.has(rawCode)) return rawCode as ContractErrorCode;
  // …else fall back to a status-derived contract code.
  switch (status) {
    case 400:
      return "validation_error";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "validation_error";
    default:
      return "upstream_error";
  }
}

// Map any thrown value to a contract-shaped error. CRITICAL: this must never
// surface the credential or arbitrary upstream payloads. The secret only ever
// lives in the SDK client's Authorization header and is never part of a
// BaoBoxError, so mapping status/code/message is safe; the raw `body` is
// deliberately dropped.
function toContractError(err: unknown, op?: SkillStudioOp): ContractError {
  if (err instanceof AuthzDenied) {
    return { status: 403, code: "forbidden", message: err.message };
  }
  if (err instanceof BaoBoxError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return {
      status,
      code: normalizeContractCode(err.code, status, op),
      message: err.message,
      ...(err.requestId ? { requestId: err.requestId } : {}),
    };
  }
  return { status: 500, code: "internal_error", message: "Internal error" };
}

// Per-tenant parameters: a value marked `secret` must NEVER leave the server in
// cleartext (#258 / #259). The host's store owns the real value; the BFF blanks
// it in every response so the browser only ever sees that a secret is set.
function maskSecretParameters(parameters: SkillParameter[]): SkillParameter[] {
  return parameters.map((p) => (p.secret ? { ...p, value: "" } : p));
}

/**
 * Build a mountable Hono router that serves the full `@baobox/skill-builder-contract`
 * surface — the Phase-1 reads/edit (`GET /skills`, `GET /skills/:id`,
 * `PATCH /skills/:id`) plus the Phase-2 authoring ops (create, structural update,
 * sub-skill attach/detach, tool attach/detach, per-tenant parameters) — by
 * calling `@baobox/sdk` scoped to a single tenant.
 *
 * Mount it under any base path on the tenant's backend, e.g.
 * `app.route("/api/skill-studio", createSkillBuilderBff({ ... }))`, and point
 * the `<baobox-skill-builder>` element's `api-base` at that base.
 */
export function createSkillBuilderBff(config: SkillStudioBffConfig): Hono {
  const { tenantId } = config;
  const hooks: SkillStudioHooks = config.hooks ?? {};
  const parameterStore: ParameterStore | undefined = hooks.parameters;
  // #254 — fail closed. Without an authz hook the BFF denies everything unless
  // the host explicitly opts out. Warn loudly at mount so a forgotten hook is
  // obvious in logs rather than silently bricking every request.
  const allowUnauthenticated = config.allowUnauthenticated === true;
  if (!hooks.authz && !allowUnauthenticated && typeof console !== "undefined") {
    console.warn(
      "[skill-builder-bff] No `hooks.authz` configured — running fail-closed: " +
        "every request will be denied (403). Provide hooks.authz, or set " +
        "allowUnauthenticated:true only if another layer already authorizes callers.",
    );
  }
  // #254 AC1 — authenticate to BaoBox with a per-tenant `apiKey` (recommended)
  // or the legacy cross-tenant `adminSecret`. Exactly one is required (unless a
  // pre-built `client` is injected for tests). Fail loud at construction rather
  // than at the first request.
  let client: BaoBoxClient;
  if (config.client) {
    client = config.client;
  } else {
    // `trim()` so a whitespace-only value isn't mistaken for a real credential
    // (and never lands in `secrets`, where it would scrub spaces from errors).
    const hasApiKey = typeof config.apiKey === "string" && config.apiKey.trim().length > 0;
    const hasAdminSecret =
      typeof config.adminSecret === "string" && config.adminSecret.trim().length > 0;
    if (hasApiKey === hasAdminSecret) {
      throw new Error(
        "[skill-builder-bff] Provide exactly one of `apiKey` (recommended) or `adminSecret`.",
      );
    }
    client = new BaoBoxClient({
      endpoint: config.endpoint,
      ...(hasApiKey ? { apiKey: config.apiKey } : { adminSecret: config.adminSecret }),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
  }

  // Belt-and-braces: the credential is never part of a BaoBoxError to begin
  // with (it only lives in the request Authorization header), but since we know
  // the value we scrub BOTH possible credentials from every outgoing message so
  // neither can EVER surface in a response — even if a future upstream error
  // were to echo it.
  const secrets = [config.apiKey, config.adminSecret].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
  const redact = (msg: string): string =>
    secrets.reduce((acc, secret) => acc.split(secret).join("[redacted]"), msg);

  // Best-effort audit — a throwing/rejecting audit hook never fails the request.
  async function audit(record: AuditRecord): Promise<void> {
    if (!hooks.audit) return;
    try {
      await hooks.audit(record);
    } catch {
      // swallow — auditing is observability, not a gate
    }
  }

  // Git-truth control point (#259). Fired after a structural mutation commits.
  // Best-effort: the BaoBox write is already authoritative, so a throwing
  // `onMutation` must not fail the request — the failure is recorded via audit.
  async function notifyMutation(event: SkillMutationEvent): Promise<void> {
    if (!hooks.onMutation) return;
    try {
      await hooks.onMutation(event);
    } catch {
      await audit({
        op: event.op,
        tenantId,
        ...(event.skillId ? { skillId: event.skillId } : {}),
        ...(event.childSkillId ? { childSkillId: event.childSkillId } : {}),
        ...(event.toolId ? { toolId: event.toolId } : {}),
        outcome: "error",
        error: { status: 500, code: "mutation_hook_failed" },
      });
    }
  }

  // Run the authz hook; deny by returning `false` OR by throwing — both map to
  // AuthzDenied → 403. A throw is treated as denial (not a 500) so a host can
  // `throw new Error("nope")` to reject; the message is preserved. Authorization
  // always runs BEFORE any request body is read, on URL-derived context only.
  async function authorize(
    op: SkillStudioOp,
    target?: { skillId?: string; childSkillId?: string; toolId?: string },
  ): Promise<void> {
    if (!hooks.authz) {
      // Fail closed: no authz hook → deny, unless the host explicitly opted out.
      if (allowUnauthenticated) return;
      throw new AuthzDenied();
    }
    let verdict: boolean | void;
    try {
      verdict = await hooks.authz({
        op,
        tenantId,
        ...(target?.skillId ? { skillId: target.skillId } : {}),
        ...(target?.childSkillId ? { childSkillId: target.childSkillId } : {}),
        ...(target?.toolId ? { toolId: target.toolId } : {}),
      });
    } catch (err) {
      throw new AuthzDenied(err instanceof Error && err.message ? err.message : "Not authorized");
    }
    if (verdict === false) throw new AuthzDenied();
  }

  async function respondError(
    c: Context,
    err: unknown,
    op: SkillStudioOp,
    target?: { skillId?: string; childSkillId?: string; toolId?: string },
  ): Promise<Response> {
    const e = toContractError(err, op);
    // "denied" is reserved for a local authz rejection; any other failure
    // (including an upstream 403, should one ever occur) is "error".
    const denied = err instanceof AuthzDenied;
    await audit({
      op,
      tenantId,
      ...(target?.skillId ? { skillId: target.skillId } : {}),
      ...(target?.childSkillId ? { childSkillId: target.childSkillId } : {}),
      ...(target?.toolId ? { toolId: target.toolId } : {}),
      outcome: denied ? "denied" : "error",
      error: { status: e.status, code: e.code },
    });
    // Redact the secret from EVERY outgoing string field, not just the message,
    // so it can never surface via `code` or `requestId` either (#248 AC).
    return c.json(
      {
        error: {
          code: redact(e.code),
          message: redact(e.message),
          ...(e.requestId ? { requestId: redact(e.requestId) } : {}),
        },
      },
      e.status as 400 | 403 | 404 | 409 | 422 | 500 | 502,
    );
  }

  // SDK 0.18.0 typed `SkillWithFiles.reasoningEffort` as `ReasoningEffort | null |
  // undefined` (SQL NULL from the database). The contract's `SkillDetail` only
  // accepts `undefined` (the schema strips the field when absent). Normalize
  // `null` → `undefined` so downstream contract consumers never see null.
  function normalizeSkillDetail(s: SkillWithFiles): SkillDetail {
    if (s.reasoningEffort === null) {
      const { reasoningEffort: _dropped, ...rest } = s as SkillWithFiles & { reasoningEffort: null };
      return rest as SkillDetail;
    }
    return s as SkillDetail;
  }

  // Apply the host's source-of-truth detail decorator (if any) before responding.
  async function decorateDetail(detail: SkillWithFiles, skillId: string): Promise<SkillDetail> {
    const normalized = normalizeSkillDetail(detail);
    if (hooks.sourceOfTruth?.detail) {
      return hooks.sourceOfTruth.detail(normalized, { tenantId, skillId });
    }
    return normalized;
  }

  const app = new Hono();

  // -------------------------------------------------------------------------
  // Phase 1 — list / get / single-field PATCH (unchanged behaviour).
  // -------------------------------------------------------------------------

  // GET /skills → { data: SkillSummary[] }
  app.get("/skills", async (c) => {
    try {
      await authorize("list");
      const skills = await client.skills.list({ tenantId });
      let summaries: SkillSummary[] = skills.map(toSkillSummary);
      if (hooks.sourceOfTruth?.list) {
        summaries = await hooks.sourceOfTruth.list(summaries, { tenantId });
      }
      await audit({ op: "list", tenantId, outcome: "allowed" });
      return c.json({ data: summaries });
    } catch (err) {
      return respondError(c, err, "list");
    }
  });

  // GET /skills/:id → { data: SkillDetail }
  app.get("/skills/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("get", { skillId: id });
      const detail = await decorateDetail(await client.skills.get(id, { tenantId }), id);
      await audit({ op: "get", tenantId, skillId: id, outcome: "allowed" });
      return c.json({ data: detail });
    } catch (err) {
      return respondError(c, err, "get", { skillId: id });
    }
  });

  // PATCH /skills/:id (single field) → { data: SkillDetail }
  app.patch("/skills/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("update", { skillId: id });
      const raw = await c.req.json().catch(() => undefined);
      const parsed = skillUpdateRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return validationError(c, "update", id, parsed.error.issues[0]?.message);
      }
      const updatedField = Object.keys(parsed.data)[0];
      const beforeRaw = hooks.onMutation ? await client.skills.get(id, { tenantId }) : undefined;
      const before = beforeRaw ? normalizeSkillDetail(beforeRaw) : undefined;
      // SDK `update` returns a Skill (no files); the contract's PATCH returns a
      // full SkillDetail, so re-fetch the detail after writing. Both calls are
      // tenant-scoped, so a cross-tenant skill 404s on the write itself.
      await client.skills.update(id, parsed.data, { tenantId });
      const after = normalizeSkillDetail(await client.skills.get(id, { tenantId }));
      await notifyMutation({ op: "update", tenantId, skillId: id, before, after });
      await audit({
        op: "update",
        tenantId,
        skillId: id,
        outcome: "allowed",
        ...(updatedField ? { updatedField } : {}),
      });
      return c.json({ data: await decorateDetail(after, id) });
    } catch (err) {
      return respondError(c, err, "update", { skillId: id });
    }
  });

  // -------------------------------------------------------------------------
  // Phase 2 — authoring surface (#259).
  // -------------------------------------------------------------------------

  // POST /skills (create, tenant-owned) → { data: SkillDetail }
  app.post("/skills", async (c) => {
    try {
      await authorize("create");
      const raw = await c.req.json().catch(() => undefined);
      const parsed = skillCreateRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return validationError(c, "create", undefined, parsed.error.issues[0]?.message);
      }
      // apiKey client → tenant-owned; the `{ tenantId }` scope is belt-and-braces.
      const created = await client.skills.create(parsed.data, { tenantId });
      const after = normalizeSkillDetail(await client.skills.get(created.id, { tenantId }));
      await notifyMutation({ op: "create", tenantId, skillId: created.id, after });
      await audit({ op: "create", tenantId, skillId: created.id, outcome: "allowed" });
      return c.json({ data: await decorateDetail(after, created.id) }, 201);
    } catch (err) {
      return respondError(c, err, "create");
    }
  });

  // PUT /skills/:id (structural multi-field update) → { data: SkillDetail }
  app.put("/skills/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("updateStructural", { skillId: id });
      const raw = await c.req.json().catch(() => undefined);
      const parsed = skillStructuralUpdateRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return validationError(c, "updateStructural", id, parsed.error.issues[0]?.message);
      }
      const updatedFields = Object.keys(parsed.data);
      const beforeRawSU = hooks.onMutation ? await client.skills.get(id, { tenantId }) : undefined;
      const beforeSU = beforeRawSU ? normalizeSkillDetail(beforeRawSU) : undefined;
      await client.skills.update(id, parsed.data, { tenantId });
      const afterSU = normalizeSkillDetail(await client.skills.get(id, { tenantId }));
      await notifyMutation({ op: "updateStructural", tenantId, skillId: id, before: beforeSU, after: afterSU });
      await audit({ op: "updateStructural", tenantId, skillId: id, outcome: "allowed", updatedFields });
      return c.json({ data: await decorateDetail(afterSU, id) });
    } catch (err) {
      return respondError(c, err, "updateStructural", { skillId: id });
    }
  });

  // GET /skills/:id/attached-skills → { data: SkillSummary[] }
  app.get("/skills/:id/attached-skills", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("listAttachedSkills", { skillId: id });
      const children = await client.skills.listAttachedSkills(id, { tenantId });
      await audit({ op: "listAttachedSkills", tenantId, skillId: id, outcome: "allowed" });
      return c.json({ data: children.map(toSkillSummary) });
    } catch (err) {
      return respondError(c, err, "listAttachedSkills", { skillId: id });
    }
  });

  // POST /skills/:id/attached-skills (body: { childSkillId }) → { data: { attached } }
  app.post("/skills/:id/attached-skills", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("attachSkill", { skillId: id });
      const raw = await c.req.json().catch(() => undefined);
      const parsed = attachSubSkillRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return validationError(c, "attachSkill", id, parsed.error.issues[0]?.message);
      }
      const childSkillId = parsed.data.childSkillId;
      // 422 cycle_detected / 404 not_found propagate from the worker; mapped in catch.
      await client.skills.attachSkill(id, childSkillId, { tenantId });
      await notifyMutation({ op: "attachSkill", tenantId, skillId: id, childSkillId });
      await audit({ op: "attachSkill", tenantId, skillId: id, childSkillId, outcome: "allowed" });
      return c.json({ data: { attached: true } });
    } catch (err) {
      return respondError(c, err, "attachSkill", { skillId: id });
    }
  });

  // DELETE /skills/:id/attached-skills/:childId → { data: { detached } }
  app.delete("/skills/:id/attached-skills/:childId", async (c) => {
    const id = c.req.param("id");
    const childSkillId = c.req.param("childId");
    try {
      await authorize("detachSkill", { skillId: id, childSkillId });
      await client.skills.detachSkill(id, childSkillId, { tenantId });
      await notifyMutation({ op: "detachSkill", tenantId, skillId: id, childSkillId });
      await audit({ op: "detachSkill", tenantId, skillId: id, childSkillId, outcome: "allowed" });
      return c.json({ data: { detached: true } });
    } catch (err) {
      return respondError(c, err, "detachSkill", { skillId: id, childSkillId });
    }
  });

  // GET /skills/:id/tools → { data: SkillToolSummary[] }
  app.get("/skills/:id/tools", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("listTools", { skillId: id });
      const tools = await client.skills.listTools(id, { tenantId });
      // SECURITY: project to the lean summary — NEVER ship `handlerConfig` /
      // `inputSchema` (which may carry callback secrets) to the browser.
      const summaries: SkillToolSummary[] = tools.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
      }));
      await audit({ op: "listTools", tenantId, skillId: id, outcome: "allowed" });
      return c.json({ data: summaries });
    } catch (err) {
      return respondError(c, err, "listTools", { skillId: id });
    }
  });

  // GET /tools → { data: SkillToolSummary[] }
  // Returns the tenant's ATTACHABLE tool allowlist (own + global tools visible
  // to this tenant's credential). DISTINCT from GET /skills/:id/tools, which
  // returns tools already attached to a specific skill. The `authz` hook sees
  // op="listAvailableTools" with no skillId — the allowlist is tenant-level.
  // SECURITY: same projection as listTools — handlerConfig / inputSchema are
  // dropped; neither carries a skillId to the authz hook (not scoped to a skill).
  app.get("/tools", async (c) => {
    try {
      await authorize("listAvailableTools");
      const tools = await client.tools.list();
      // SECURITY: project to the lean summary — NEVER ship `handlerConfig` /
      // `inputSchema` (which may carry callback secrets) to the browser.
      const summaries: SkillToolSummary[] = tools.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
      }));
      await audit({ op: "listAvailableTools", tenantId, outcome: "allowed" });
      return c.json({ data: summaries });
    } catch (err) {
      return respondError(c, err, "listAvailableTools");
    }
  });

  // GET /models → { providers, reasoningEfforts } (#320)
  // Returns the live LLM model catalog from `client.catalog.list()`.
  // ADMIN_SECRET-gated: an apiKey-only BFF will get a 401 from the SDK, which
  // propagates as an upstream_error → the web falls back to the static catalog.
  // The catalog carries no secrets, so the response is returned as-is.
  // The `authz` hook sees op="listModels" with no skillId (not tenant-scoped).
  app.get("/models", async (c) => {
    try {
      await authorize("listModels");
      const catalog = await client.catalog.list();
      await audit({ op: "listModels", tenantId, outcome: "allowed" });
      return c.json({ providers: catalog.providers, reasoningEfforts: catalog.reasoningEfforts });
    } catch (err) {
      return respondError(c, err, "listModels");
    }
  });

  // GET /skills/:id/role-models → SkillRoleModelsMap (#328)
  // Returns the full role → chain map for the skill. Requires `skills:read`.
  // The result is passed through as-is (no secrets, no filtering needed).
  app.get("/skills/:id/role-models", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("getRoleModels", { skillId: id });
      const roleModels = await client.skills.roleModels.get(id, { tenantId });
      await audit({ op: "getRoleModels", tenantId, skillId: id, outcome: "allowed" });
      return c.json(roleModels);
    } catch (err) {
      return respondError(c, err, "getRoleModels", { skillId: id });
    }
  });

  // PUT /skills/:id/role-models (body: { role, chain }) → { role, chain } (#328)
  // Replaces the model chain for a single role. Requires `skills:write`.
  // The chain is validated by the contract schema before reaching the SDK.
  app.put("/skills/:id/role-models", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("putRoleModels", { skillId: id });
      const raw = await c.req.json().catch(() => undefined);
      const parsed = putRoleModelsRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return validationError(c, "putRoleModels", id, parsed.error.issues[0]?.message);
      }
      const result = await client.skills.roleModels.put(
        id,
        { role: parsed.data.role, chain: parsed.data.chain },
        { tenantId },
      );
      await notifyMutation({ op: "putRoleModels", tenantId, skillId: id });
      await audit({ op: "putRoleModels", tenantId, skillId: id, outcome: "allowed" });
      return c.json(result);
    } catch (err) {
      return respondError(c, err, "putRoleModels", { skillId: id });
    }
  });

  // POST /skills/:id/tools (body: { toolId }) → { data: { attached } }
  app.post("/skills/:id/tools", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("attachTool", { skillId: id });
      const raw = await c.req.json().catch(() => undefined);
      const parsed = attachToolRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return validationError(c, "attachTool", id, parsed.error.issues[0]?.message);
      }
      const toolId = parsed.data.toolId;
      // 403 off-allowlist → tool_not_allowed / 404 not_found propagate; mapped in catch.
      await client.skills.attachTool(id, toolId, { tenantId });
      await notifyMutation({ op: "attachTool", tenantId, skillId: id, toolId });
      await audit({ op: "attachTool", tenantId, skillId: id, toolId, outcome: "allowed" });
      return c.json({ data: { attached: true } });
    } catch (err) {
      return respondError(c, err, "attachTool", { skillId: id });
    }
  });

  // DELETE /skills/:id/tools/:toolId → { data: { detached } }
  app.delete("/skills/:id/tools/:toolId", async (c) => {
    const id = c.req.param("id");
    const toolId = c.req.param("toolId");
    try {
      await authorize("detachTool", { skillId: id, toolId });
      await client.skills.detachTool(id, toolId, { tenantId });
      await notifyMutation({ op: "detachTool", tenantId, skillId: id, toolId });
      await audit({ op: "detachTool", tenantId, skillId: id, toolId, outcome: "allowed" });
      return c.json({ data: { detached: true } });
    } catch (err) {
      return respondError(c, err, "detachTool", { skillId: id, toolId });
    }
  });

  // GET /skills/:id/parameters → { data: SkillParameter[] }
  app.get("/skills/:id/parameters", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("getParameters", { skillId: id });
      // No store configured → the parameter feature is off for this deployment;
      // a read is harmless (nothing is stored), so return an empty list.
      const params = parameterStore
        ? await parameterStore.get({ tenantId, skillId: id })
        : [];
      await audit({ op: "getParameters", tenantId, skillId: id, outcome: "allowed" });
      return c.json({ data: maskSecretParameters(params) });
    } catch (err) {
      return respondError(c, err, "getParameters", { skillId: id });
    }
  });

  // PUT /skills/:id/parameters (body: { parameters }) → { data: SkillParameter[] }
  app.put("/skills/:id/parameters", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("setParameters", { skillId: id });
      const raw = await c.req.json().catch(() => undefined);
      const parsed = setSkillParametersRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return validationError(c, "setParameters", id, parsed.error.issues[0]?.message);
      }
      if (!parameterStore) {
        // The route exists but the host hasn't wired durable storage. Refuse the
        // write rather than silently dropping it.
        return respondError(
          c,
          new AuthzDenied("Per-tenant parameters are not enabled (no parameter store configured)"),
          "setParameters",
          { skillId: id },
        );
      }
      const stored = await parameterStore.set(parsed.data.parameters, { tenantId, skillId: id });
      const result = maskSecretParameters(stored ?? parsed.data.parameters);
      await notifyMutation({ op: "setParameters", tenantId, skillId: id });
      await audit({ op: "setParameters", tenantId, skillId: id, outcome: "allowed" });
      return c.json({ data: result });
    } catch (err) {
      return respondError(c, err, "setParameters", { skillId: id });
    }
  });

  // GET /llm-integrations → { data: LlmIntegration[] } (#330)
  // Returns the tenant's configured LLM integrations. API-safe — no real
  // credentials; `apiKeyMask` is always `"***"`. The `authz` hook sees
  // op="listLlmIntegrations" with no skillId (tenant-level, not skill-scoped).
  app.get("/llm-integrations", async (c) => {
    try {
      await authorize("listLlmIntegrations");
      const integrations: LlmIntegration[] = await client.llmIntegrations.list({ tenantId });
      await audit({ op: "listLlmIntegrations", tenantId, outcome: "allowed" });
      return c.json({ data: integrations });
    } catch (err) {
      return respondError(c, err, "listLlmIntegrations");
    }
  });

  // GET /llm-integrations/:id/models → IntegrationModelsView (#330)
  // Returns the live model list for a specific integration. `providerListError`
  // is non-null when the provider list fetch failed — the Web Component surfaces
  // this as a soft note and still shows any catalog models. The `authz` hook
  // sees op="listIntegrationModels" with no skillId.
  app.get("/llm-integrations/:id/models", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("listIntegrationModels");
      const view: IntegrationModelsView = await client.llmIntegrations.listModels(id, { tenantId });
      await audit({ op: "listIntegrationModels", tenantId, outcome: "allowed" });
      return c.json(view);
    } catch (err) {
      return respondError(c, err, "listIntegrationModels");
    }
  });

  // Shared 400 path for a request-body schema failure. Uses the contract's
  // stable `validation_error` code (the Web Component branches on it).
  function validationError(
    c: Context,
    op: SkillStudioMutationOp,
    skillId: string | undefined,
    message?: string,
  ): Response {
    void audit({
      op,
      tenantId,
      ...(skillId ? { skillId } : {}),
      outcome: "error",
      error: { status: 400, code: "validation_error" },
    });
    return c.json(
      {
        error: {
          code: "validation_error" as ContractErrorCode,
          // Defense-in-depth: a strict-schema parse on a body that smuggled a
          // credential-named key echoes that key in the Zod message — redact it,
          // exactly as `respondError` does for every other error path.
          message: redact(message ?? "Invalid request"),
        },
      },
      400,
    );
  }

  return app;
}

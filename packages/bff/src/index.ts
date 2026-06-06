import { BaoBoxClient, BaoBoxError } from "@baobox/sdk";
import {
  type SkillDetail,
  type SkillSummary,
  skillUpdateRequestSchema,
  toSkillSummary,
} from "@baobox/skill-builder-contract";
import { type Context, Hono } from "hono";
import type { AuditRecord, SkillStudioBffConfig, SkillStudioHooks, SkillStudioOp } from "./types.js";

export type {
  AuditRecord,
  AuthzContext,
  SkillStudioBffConfig,
  SkillStudioHooks,
  SkillStudioOp,
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
  code: string;
  message: string;
  requestId?: string;
}

// Map any thrown value to a contract-shaped error. CRITICAL: this must never
// surface the `adminSecret` or arbitrary upstream payloads. The secret only
// ever lives in the SDK client's Authorization header and is never part of a
// BaoBoxError, so mapping status/code/message is safe; the raw `body` is
// deliberately dropped.
function toContractError(err: unknown): ContractError {
  if (err instanceof AuthzDenied) {
    return { status: 403, code: "forbidden", message: err.message };
  }
  if (err instanceof BaoBoxError) {
    const status = err.status >= 400 && err.status < 600 ? err.status : 502;
    return {
      status,
      code: err.code || "upstream_error",
      message: err.message,
      ...(err.requestId ? { requestId: err.requestId } : {}),
    };
  }
  return { status: 500, code: "internal_error", message: "Internal error" };
}

/**
 * Build a mountable Hono router that serves the `@baobox/skill-builder-contract`
 * Phase-1 surface (`GET /skills`, `GET /skills/:id`, `PATCH /skills/:id`) by
 * calling `@baobox/sdk` scoped to a single tenant.
 *
 * Mount it under any base path on the tenant's backend, e.g.
 * `app.route("/api/skill-studio", createSkillBuilderBff({ ... }))`, and point
 * the `<baobox-skill-builder>` element's `api-base` at that base.
 */
export function createSkillBuilderBff(config: SkillStudioBffConfig): Hono {
  const { tenantId } = config;
  const hooks: SkillStudioHooks = config.hooks ?? {};
  const client =
    config.client ??
    new BaoBoxClient({
      endpoint: config.endpoint,
      adminSecret: config.adminSecret,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });

  // Belt-and-braces: the adminSecret is never part of a BaoBoxError to begin
  // with (it only lives in the request Authorization header), but since we know
  // the value we scrub it from every outgoing message so it can NEVER surface
  // in a response — even if a future upstream error were to echo it.
  const redact = (msg: string): string =>
    config.adminSecret ? msg.split(config.adminSecret).join("[redacted]") : msg;

  // Best-effort audit — a throwing/ rejecting audit hook never fails the request.
  async function audit(record: AuditRecord): Promise<void> {
    if (!hooks.audit) return;
    try {
      await hooks.audit(record);
    } catch {
      // swallow — auditing is observability, not a gate
    }
  }

  // Run the authz hook; deny by returning `false` OR by throwing — both map to
  // AuthzDenied → 403. A throw is treated as denial (not a 500) so a host can
  // `throw new Error("nope")` to reject; the message is preserved.
  async function authorize(op: SkillStudioOp, skillId?: string): Promise<void> {
    if (!hooks.authz) return;
    let verdict: boolean | void;
    try {
      verdict = await hooks.authz({ op, tenantId, ...(skillId ? { skillId } : {}) });
    } catch (err) {
      throw new AuthzDenied(err instanceof Error && err.message ? err.message : "Not authorized");
    }
    if (verdict === false) throw new AuthzDenied();
  }

  async function respondError(
    c: Context,
    err: unknown,
    op: SkillStudioOp,
    skillId?: string,
  ): Promise<Response> {
    const e = toContractError(err);
    // "denied" is reserved for a local authz rejection; any other failure
    // (including an upstream 403, should one ever occur) is "error".
    const denied = err instanceof AuthzDenied;
    await audit({
      op,
      tenantId,
      ...(skillId ? { skillId } : {}),
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
      e.status as 400 | 403 | 404 | 500 | 502,
    );
  }

  const app = new Hono();

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
      await authorize("get", id);
      let detail: SkillDetail = await client.skills.get(id, { tenantId });
      if (hooks.sourceOfTruth?.detail) {
        detail = await hooks.sourceOfTruth.detail(detail, { tenantId, skillId: id });
      }
      await audit({ op: "get", tenantId, skillId: id, outcome: "allowed" });
      return c.json({ data: detail });
    } catch (err) {
      return respondError(c, err, "get", id);
    }
  });

  // PATCH /skills/:id (single field) → { data: SkillDetail }
  app.patch("/skills/:id", async (c) => {
    const id = c.req.param("id");
    try {
      await authorize("update", id);
      const raw = await c.req.json().catch(() => undefined);
      const parsed = skillUpdateRequestSchema.safeParse(raw);
      if (!parsed.success) {
        await audit({
          op: "update",
          tenantId,
          skillId: id,
          outcome: "error",
          error: { status: 400, code: "invalid_request" },
        });
        return c.json(
          {
            error: {
              code: "invalid_request",
              message: parsed.error.issues[0]?.message ?? "Invalid update request",
            },
          },
          400,
        );
      }
      const updatedField = Object.keys(parsed.data)[0];
      // SDK `update` returns a Skill (no files); the contract's PATCH returns a
      // full SkillDetail, so re-fetch the detail after writing. Both calls are
      // tenant-scoped, so a cross-tenant skill 404s on the write itself.
      await client.skills.update(id, parsed.data, { tenantId });
      let detail: SkillDetail = await client.skills.get(id, { tenantId });
      if (hooks.sourceOfTruth?.detail) {
        detail = await hooks.sourceOfTruth.detail(detail, { tenantId, skillId: id });
      }
      await audit({
        op: "update",
        tenantId,
        skillId: id,
        outcome: "allowed",
        ...(updatedField ? { updatedField } : {}),
      });
      return c.json({ data: detail });
    } catch (err) {
      return respondError(c, err, "update", id);
    }
  });

  return app;
}

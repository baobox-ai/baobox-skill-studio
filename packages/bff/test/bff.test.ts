import { BaoBoxError } from "@baobox/sdk";
import type { Skill, SkillWithFiles } from "@baobox/skill-builder-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AuditRecord, createSkillBuilderBff } from "../src/index.js";

const ADMIN_SECRET = "adm-super-secret-DO-NOT-LEAK";
const TENANT = "t_acme";

function skill(id: string, over: Partial<Skill> = {}): Skill {
  return {
    id,
    name: `Skill ${id}`,
    description: "desc",
    systemPrompt: "prompt",
    model: "MiniMax-M2.7",
    temperature: 0.7,
    maxTokens: 4096,
    sourceUrl: null,
    tenantId: TENANT,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...over,
  };
}

function withFiles(s: Skill): SkillWithFiles {
  return { ...s, files: [{ path: "SKILL.md", size: 42 }] };
}

// Minimal stub shaped like the @baobox/sdk client's `skills` surface.
function makeStub(impl: {
  list?: (opts?: { tenantId?: string }) => Promise<Skill[]>;
  get?: (id: string, opts?: { tenantId?: string }) => Promise<SkillWithFiles>;
  update?: (
    id: string,
    req: Record<string, unknown>,
    opts?: { tenantId?: string },
  ) => Promise<Skill>;
}) {
  const calls = {
    list: vi.fn(impl.list ?? (async () => [])),
    get: vi.fn(impl.get ?? (async (id: string) => withFiles(skill(id)))),
    update: vi.fn(impl.update ?? (async (id: string) => skill(id))),
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub stands in for BaoBoxClient
  const client = { skills: calls } as any;
  return { client, calls };
}

// These suites exercise plumbing/validation/audit, not authz, so they opt into
// `allowUnauthenticated` — the fail-closed default (#254) is covered separately
// in the "fail-closed defaults" suite below.
function makeBff(stub: ReturnType<typeof makeStub>, hooks?: Parameters<typeof createSkillBuilderBff>[0]["hooks"]) {
  return createSkillBuilderBff({
    endpoint: "https://baobox.example.com",
    adminSecret: ADMIN_SECRET,
    tenantId: TENANT,
    client: stub.client,
    allowUnauthenticated: true,
    ...(hooks ? { hooks } : {}),
  });
}

describe("createSkillBuilderBff — list/get/update round-trip", () => {
  it("GET /skills returns summaries scoped to the tenant", async () => {
    const stub = makeStub({ list: async () => [skill("sk_1"), skill("sk_2")] });
    const app = makeBff(stub);

    const res = await app.request("/skills");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; systemPrompt?: string }> };
    expect(body.data.map((s) => s.id)).toEqual(["sk_1", "sk_2"]);
    // summary is lean — no systemPrompt leaks into the list
    expect(body.data[0]).not.toHaveProperty("systemPrompt");
    expect(stub.calls.list).toHaveBeenCalledWith({ tenantId: TENANT });
  });

  it("GET /skills/:id returns the detail (with files) scoped to the tenant", async () => {
    const stub = makeStub({ get: async (id) => withFiles(skill(id)) });
    const app = makeBff(stub);

    const res = await app.request("/skills/sk_1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; files: unknown[]; systemPrompt: string } };
    expect(body.data.id).toBe("sk_1");
    expect(body.data.systemPrompt).toBe("prompt");
    expect(body.data.files).toHaveLength(1);
    expect(stub.calls.get).toHaveBeenCalledWith("sk_1", { tenantId: TENANT });
  });

  it("PATCH /skills/:id updates one field then returns the fresh detail", async () => {
    const stub = makeStub({
      update: async (id) => skill(id, { description: "edited" }),
      get: async (id) => withFiles(skill(id, { description: "edited" })),
    });
    const app = makeBff(stub);

    const res = await app.request("/skills/sk_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "edited" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { description: string } };
    expect(body.data.description).toBe("edited");
    expect(stub.calls.update).toHaveBeenCalledWith("sk_1", { description: "edited" }, { tenantId: TENANT });
    expect(stub.calls.get).toHaveBeenCalledWith("sk_1", { tenantId: TENANT });
  });
});

describe("createSkillBuilderBff — validation", () => {
  it("rejects an empty PATCH body with 400 and does not call the SDK", async () => {
    const stub = makeStub({});
    const app = makeBff(stub);

    const res = await app.request("/skills/sk_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it("rejects a multi-field PATCH body (Phase 1 is single-field) with 400", async () => {
    const stub = makeStub({});
    const app = makeBff(stub);

    const res = await app.request("/skills/sk_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X", description: "Y" }),
    });
    expect(res.status).toBe(400);
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown key (e.g. tenantId) with 400", async () => {
    const stub = makeStub({});
    const app = makeBff(stub);

    const res = await app.request("/skills/sk_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "t_other" }),
    });
    expect(res.status).toBe(400);
    expect(stub.calls.update).not.toHaveBeenCalled();
  });
});

describe("createSkillBuilderBff — authz", () => {
  it("denies (403) and never calls the SDK when authz returns false", async () => {
    const stub = makeStub({ list: async () => [skill("sk_1")] });
    const app = makeBff(stub, { authz: () => false });

    const res = await app.request("/skills");
    expect(res.status).toBe(403);
    expect(stub.calls.list).not.toHaveBeenCalled();
  });

  it("denies (403) and never calls the SDK when authz throws", async () => {
    const stub = makeStub({ list: async () => [skill("sk_1")] });
    const app = makeBff(stub, {
      authz: () => {
        throw new Error("policy says no");
      },
    });

    const res = await app.request("/skills");
    expect(res.status).toBe(403);
    expect(stub.calls.list).not.toHaveBeenCalled();
  });

  it("passes the op + skillId + tenantId to the authz hook", async () => {
    const stub = makeStub({});
    const authz = vi.fn(() => true);
    const app = makeBff(stub, { authz });

    await app.request("/skills/sk_9");
    expect(authz).toHaveBeenCalledWith({ op: "get", tenantId: TENANT, skillId: "sk_9" });
  });
});

describe("createSkillBuilderBff — audit", () => {
  it("records an allowed list and a denied get", async () => {
    const records: AuditRecord[] = [];
    const stub = makeStub({ list: async () => [skill("sk_1")] });
    const app = makeBff(stub, {
      audit: (r) => {
        records.push(r);
      },
      authz: ({ op }) => op !== "get", // allow list, deny get
    });

    await app.request("/skills");
    await app.request("/skills/sk_1");

    expect(records).toContainEqual(expect.objectContaining({ op: "list", outcome: "allowed" }));
    expect(records).toContainEqual(
      expect.objectContaining({ op: "get", outcome: "denied", skillId: "sk_1" }),
    );
  });

  it("a throwing audit hook never fails the request", async () => {
    const stub = makeStub({ list: async () => [skill("sk_1")] });
    const app = makeBff(stub, {
      audit: () => {
        throw new Error("audit sink down");
      },
    });

    const res = await app.request("/skills");
    expect(res.status).toBe(200);
  });

  it("names the updated field in the audit record", async () => {
    const records: AuditRecord[] = [];
    const stub = makeStub({});
    const app = makeBff(stub, {
      audit: (r) => {
        records.push(r);
      },
    });

    await app.request("/skills/sk_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemPrompt: "new prompt" }),
    });
    expect(records).toContainEqual(
      expect.objectContaining({ op: "update", outcome: "allowed", updatedField: "systemPrompt" }),
    );
  });
});

describe("createSkillBuilderBff — error mapping & secret hygiene", () => {
  it("maps a cross-tenant 404 from the SDK to a clean 404", async () => {
    const stub = makeStub({
      get: async () => {
        throw new BaoBoxError(404, "not_found", "Skill 'sk_x' not found", "req_1", null);
      },
    });
    const app = makeBff(stub);

    const res = await app.request("/skills/sk_x");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("never leaks the adminSecret — redacted from message, code, and requestId", async () => {
    const stub = makeStub({
      list: async () => [skill("sk_1")],
      get: async () => {
        // Contrived worst case: the secret leaks into EVERY string field of the
        // upstream error. The BFF must scrub all of them.
        throw new BaoBoxError(
          500,
          `code_${ADMIN_SECRET}`,
          `failed with ${ADMIN_SECRET}`,
          `req_${ADMIN_SECRET}`,
          { ADMIN_SECRET },
        );
      },
    });
    const app = makeBff(stub);

    const ok = await (await app.request("/skills")).text();
    const errBody = await (await app.request("/skills/sk_1")).text();
    expect(ok).not.toContain(ADMIN_SECRET);
    expect(errBody).not.toContain(ADMIN_SECRET); // the actual secret value
    // and the raw upstream `body` is never echoed at all
    expect(errBody).not.toContain("ADMIN_SECRET");
  });

  it("never leaks a per-tenant apiKey — redacted from the error (#254)", async () => {
    const API_KEY = "skb_tenant_key_DO-NOT-LEAK";
    const stub = makeStub({
      get: async () => {
        throw new BaoBoxError(500, "code", `failed with ${API_KEY}`, `req_${API_KEY}`, null);
      },
    });
    const app = createSkillBuilderBff({
      endpoint: "https://baobox.example.com",
      apiKey: API_KEY,
      tenantId: TENANT,
      client: stub.client,
      allowUnauthenticated: true,
    });
    const errBody = await (await app.request("/skills/sk_1")).text();
    expect(errBody).not.toContain(API_KEY);
  });

  it("maps a non-HTTP error to 500 internal_error", async () => {
    const stub = makeStub({
      list: async () => {
        throw new Error("kaboom");
      },
    });
    const app = makeBff(stub);

    const res = await app.request("/skills");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("Internal error");
  });
});

describe("createSkillBuilderBff — credential config (#254 AC1)", () => {
  it("accepts a per-tenant apiKey (no adminSecret)", () => {
    expect(() =>
      createSkillBuilderBff({
        endpoint: "https://baobox.example.com",
        apiKey: "skb_tenant_key",
        tenantId: TENANT,
        allowUnauthenticated: true,
      }),
    ).not.toThrow();
  });

  it("throws when BOTH apiKey and adminSecret are given", () => {
    expect(() =>
      createSkillBuilderBff({
        endpoint: "https://baobox.example.com",
        apiKey: "skb_tenant_key",
        adminSecret: ADMIN_SECRET,
        tenantId: TENANT,
        allowUnauthenticated: true,
      }),
    ).toThrow(/exactly one/i);
  });

  it("throws when NEITHER apiKey nor adminSecret is given", () => {
    expect(() =>
      createSkillBuilderBff({
        endpoint: "https://baobox.example.com",
        tenantId: TENANT,
        allowUnauthenticated: true,
      } as Parameters<typeof createSkillBuilderBff>[0]),
    ).toThrow(/exactly one/i);
  });

  it("still accepts an adminSecret-only caller without an injected client (back-compat)", () => {
    expect(() =>
      createSkillBuilderBff({
        endpoint: "https://baobox.example.com",
        adminSecret: ADMIN_SECRET,
        tenantId: TENANT,
        allowUnauthenticated: true,
      }),
    ).not.toThrow();
  });

  it("treats a whitespace-only credential as absent → throws", () => {
    expect(() =>
      createSkillBuilderBff({
        endpoint: "https://baobox.example.com",
        apiKey: "   ",
        tenantId: TENANT,
        allowUnauthenticated: true,
      }),
    ).toThrow(/exactly one/i);
  });
});

describe("createSkillBuilderBff — sourceOfTruth hook", () => {
  it("lets the host decorate the list result", async () => {
    const stub = makeStub({ list: async () => [skill("sk_1")] });
    const app = makeBff(stub, {
      sourceOfTruth: {
        list: (skills) => skills.map((s) => ({ ...s, name: `★ ${s.name}` })),
      },
    });

    const res = await app.request("/skills");
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data[0]?.name).toBe("★ Skill sk_1");
  });
});

describe("createSkillBuilderBff — fail-closed defaults (#254)", () => {
  function bareBff(stub: ReturnType<typeof makeStub>, extra: Record<string, unknown> = {}) {
    return createSkillBuilderBff({
      endpoint: "https://baobox.example.com",
      adminSecret: ADMIN_SECRET,
      tenantId: TENANT,
      client: stub.client,
      ...extra,
    });
  }

  it("denies (403) and never calls the SDK when no authz hook is configured", async () => {
    const stub = makeStub({ list: async () => [skill("sk_1")] });
    const app = bareBff(stub); // no authz, no allowUnauthenticated → fail closed

    const res = await app.request("/skills");
    expect(res.status).toBe(403);
    expect(stub.calls.list).not.toHaveBeenCalled();
  });

  it("fail-closed applies to get and update too", async () => {
    const stub = makeStub({});
    const app = bareBff(stub);

    expect((await app.request("/skills/sk_1")).status).toBe(403);
    const patch = await app.request("/skills/sk_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "x" }),
    });
    expect(patch.status).toBe(403);
    expect(stub.calls.get).not.toHaveBeenCalled();
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it("allowUnauthenticated:true opts out (explicit, deliberate)", async () => {
    const stub = makeStub({ list: async () => [skill("sk_1")] });
    const app = bareBff(stub, { allowUnauthenticated: true });

    const res = await app.request("/skills");
    expect(res.status).toBe(200);
    expect(stub.calls.list).toHaveBeenCalledTimes(1);
  });

  it("a provided authz hook still governs (allowUnauthenticated irrelevant)", async () => {
    const stub = makeStub({ list: async () => [skill("sk_1")] });
    const app = bareBff(stub, { hooks: { authz: () => false } });

    expect((await app.request("/skills")).status).toBe(403);
    expect(stub.calls.list).not.toHaveBeenCalled();
  });
});

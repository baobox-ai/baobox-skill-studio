import { BaoBoxError } from "@baobox/sdk";
import type { Skill, SkillParameter, SkillWithFiles } from "@baobox/skill-builder-contract";
import { describe, expect, it, vi } from "vitest";
import {
  type AuditRecord,
  type SkillMutationEvent,
  createSkillBuilderBff,
} from "../src/index.js";

// Phase-2 authoring surface (#259): create, structural PUT, sub-skill
// attach/detach, tool attach/detach, per-tenant parameters, the git-truth
// `onMutation` hook, and tool-projection secret hygiene.

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

// A full Tool as the SDK returns it — note `handlerConfig` / `inputSchema` are
// stringified JSON that may carry CALLBACK SECRETS. The BFF must never ship them.
function tool(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Tool ${id}`,
    description: "a tool",
    inputSchema: '{"type":"object"}',
    handlerType: "http" as const,
    handlerConfig: '{"url":"https://x","secretToken":"SUPER-SECRET-CALLBACK"}',
    emitSchemaRef: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

interface StubImpl {
  list?: (opts?: { tenantId?: string }) => Promise<Skill[]>;
  get?: (id: string, opts?: { tenantId?: string }) => Promise<SkillWithFiles>;
  update?: (id: string, req: unknown, opts?: { tenantId?: string }) => Promise<Skill>;
  create?: (req: unknown, opts?: { tenantId?: string }) => Promise<Skill>;
  attachSkill?: (p: string, ch: string, opts?: { tenantId?: string }) => Promise<unknown>;
  detachSkill?: (p: string, ch: string, opts?: { tenantId?: string }) => Promise<unknown>;
  listAttachedSkills?: (id: string, opts?: { tenantId?: string }) => Promise<Skill[]>;
  attachTool?: (id: string, t: string, opts?: { tenantId?: string }) => Promise<unknown>;
  detachTool?: (id: string, t: string, opts?: { tenantId?: string }) => Promise<unknown>;
  listTools?: (id: string, opts?: { tenantId?: string }) => Promise<ReturnType<typeof tool>[]>;
}

function makeStub(impl: StubImpl = {}) {
  const calls = {
    list: vi.fn(impl.list ?? (async () => [])),
    get: vi.fn(impl.get ?? (async (id: string) => withFiles(skill(id)))),
    update: vi.fn(impl.update ?? (async (id: string) => skill(id))),
    create: vi.fn(impl.create ?? (async (_req: unknown) => skill("sk_new"))),
    attachSkill: vi.fn(impl.attachSkill ?? (async () => ({ attached: true }))),
    detachSkill: vi.fn(impl.detachSkill ?? (async () => ({ detached: true }))),
    listAttachedSkills: vi.fn(impl.listAttachedSkills ?? (async () => [])),
    attachTool: vi.fn(impl.attachTool ?? (async () => ({ attached: true }))),
    detachTool: vi.fn(impl.detachTool ?? (async () => ({ detached: true }))),
    listTools: vi.fn(impl.listTools ?? (async () => [])),
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub stands in for BaoBoxClient
  const client = { skills: calls } as any;
  return { client, calls };
}

function makeBff(
  stub: ReturnType<typeof makeStub>,
  hooks?: Parameters<typeof createSkillBuilderBff>[0]["hooks"],
) {
  return createSkillBuilderBff({
    endpoint: "https://baobox.example.com",
    apiKey: "skb_tenant_key_DO-NOT-LEAK",
    tenantId: TENANT,
    client: stub.client,
    allowUnauthenticated: true,
    ...(hooks ? { hooks } : {}),
  });
}

function postJson(app: ReturnType<typeof makeBff>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function putJson(app: ReturnType<typeof makeBff>, path: string, body: unknown) {
  return app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("create — POST /skills", () => {
  it("creates a tenant-scoped skill and returns the detail (201)", async () => {
    const stub = makeStub({
      create: async () => skill("sk_new", { name: "Brand New" }),
      get: async (id) => withFiles(skill(id, { name: "Brand New" })),
    });
    const app = makeBff(stub);
    const res = await postJson(app, "/skills", { name: "Brand New", systemPrompt: "p" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; files: unknown[] } };
    expect(body.data.id).toBe("sk_new");
    expect(body.data.files).toHaveLength(1);
    expect(stub.calls.create).toHaveBeenCalledWith(
      { name: "Brand New", systemPrompt: "p" },
      { tenantId: TENANT },
    );
  });

  it("rejects an unknown key (e.g. tenantId smuggling) with 400 validation_error", async () => {
    const stub = makeStub();
    const app = makeBff(stub);
    const res = await postJson(app, "/skills", {
      name: "X",
      systemPrompt: "p",
      tenantId: "t_other",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_error");
    expect(stub.calls.create).not.toHaveBeenCalled();
  });

  it("fires onMutation with the created skill as `after` (no `before`)", async () => {
    const events: SkillMutationEvent[] = [];
    const stub = makeStub({ create: async () => skill("sk_new") });
    const app = makeBff(stub, { onMutation: (e) => void events.push(e) });
    await postJson(app, "/skills", { name: "X", systemPrompt: "p" });
    expect(events).toHaveLength(1);
    expect(events[0]?.op).toBe("create");
    expect(events[0]?.skillId).toBe("sk_new");
    expect(events[0]?.before).toBeUndefined();
    expect(events[0]?.after?.id).toBe("sk_new");
  });
});

describe("structural update — PUT /skills/:id", () => {
  it("accepts multiple fields and returns the fresh detail", async () => {
    const stub = makeStub({
      get: async (id) => withFiles(skill(id, { name: "New", description: "Edited" })),
    });
    const app = makeBff(stub);
    const res = await putJson(app, "/skills/sk_1", { name: "New", description: "Edited" });
    expect(res.status).toBe(200);
    expect(stub.calls.update).toHaveBeenCalledWith(
      "sk_1",
      { name: "New", description: "Edited" },
      { tenantId: TENANT },
    );
  });

  it("rejects an empty body with 400", async () => {
    const stub = makeStub();
    const app = makeBff(stub);
    const res = await putJson(app, "/skills/sk_1", {});
    expect(res.status).toBe(400);
    expect(stub.calls.update).not.toHaveBeenCalled();
  });

  it("fires onMutation with before+after and audits updatedFields", async () => {
    const events: SkillMutationEvent[] = [];
    const records: AuditRecord[] = [];
    const stub = makeStub({
      get: vi
        .fn()
        .mockResolvedValueOnce(withFiles(skill("sk_1", { name: "Old" }))) // before
        .mockResolvedValueOnce(withFiles(skill("sk_1", { name: "New" }))), // after
    });
    const app = makeBff(stub, {
      onMutation: (e) => void events.push(e),
      audit: (r) => void records.push(r),
    });
    await putJson(app, "/skills/sk_1", { name: "New" });
    expect(events[0]?.op).toBe("updateStructural");
    expect(events[0]?.before?.name).toBe("Old");
    expect(events[0]?.after?.name).toBe("New");
    expect(records).toContainEqual(
      expect.objectContaining({ op: "updateStructural", outcome: "allowed", updatedFields: ["name"] }),
    );
  });

  it("does NOT fetch a `before` image when no onMutation hook is configured", async () => {
    const stub = makeStub();
    const app = makeBff(stub); // no onMutation
    await putJson(app, "/skills/sk_1", { name: "New" });
    // only the post-write `after` fetch → exactly one get call
    expect(stub.calls.get).toHaveBeenCalledTimes(1);
  });
});

describe("sub-skill graph — attach/detach", () => {
  it("attaches a child and returns { attached: true }", async () => {
    const stub = makeStub();
    const app = makeBff(stub);
    const res = await postJson(app, "/skills/sk_parent/attached-skills", { childSkillId: "sk_child" });
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ data: { attached: true } });
    expect(stub.calls.attachSkill).toHaveBeenCalledWith("sk_parent", "sk_child", { tenantId: TENANT });
  });

  it("maps a worker 422 to contract `cycle_detected`", async () => {
    const stub = makeStub({
      attachSkill: async () => {
        throw new BaoBoxError(422, "cycle_detected", "would create a cycle", "req_1", null);
      },
    });
    const app = makeBff(stub);
    const res = await postJson(app, "/skills/sk_a/attached-skills", { childSkillId: "sk_b" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("cycle_detected");
  });

  it("maps a worker 422 with a non-contract code to cycle_detected on attach", async () => {
    const stub = makeStub({
      attachSkill: async () => {
        throw new BaoBoxError(422, "some_internal_code", "nope", "req_1", null);
      },
    });
    const app = makeBff(stub);
    const res = await postJson(app, "/skills/sk_a/attached-skills", { childSkillId: "sk_b" });
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("cycle_detected");
  });

  it("maps a worker 404 to contract `not_found`", async () => {
    const stub = makeStub({
      attachSkill: async () => {
        throw new BaoBoxError(404, "skill_not_found", "no such skill", "req_1", null);
      },
    });
    const app = makeBff(stub);
    const res = await postJson(app, "/skills/sk_a/attached-skills", { childSkillId: "sk_missing" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("detaches a child (childId in the path) and audits the target", async () => {
    const records: AuditRecord[] = [];
    const stub = makeStub();
    const app = makeBff(stub, { audit: (r) => void records.push(r) });
    const res = await app.request("/skills/sk_parent/attached-skills/sk_child", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(stub.calls.detachSkill).toHaveBeenCalledWith("sk_parent", "sk_child", { tenantId: TENANT });
    expect(records).toContainEqual(
      expect.objectContaining({ op: "detachSkill", childSkillId: "sk_child", outcome: "allowed" }),
    );
  });

  it("lists attached sub-skills as lean summaries (no systemPrompt)", async () => {
    const stub = makeStub({ listAttachedSkills: async () => [skill("sk_c1"), skill("sk_c2")] });
    const app = makeBff(stub);
    const res = await app.request("/skills/sk_parent/attached-skills");
    const body = (await res.json()) as { data: Array<{ id: string; systemPrompt?: string }> };
    expect(body.data.map((s) => s.id)).toEqual(["sk_c1", "sk_c2"]);
    expect(body.data[0]).not.toHaveProperty("systemPrompt");
  });
});

describe("tool wiring — attach/detach/list", () => {
  it("SECURITY: list projects to {id,name,description} and never leaks handlerConfig", async () => {
    const stub = makeStub({ listTools: async () => [tool("tl_1"), tool("tl_2")] });
    const app = makeBff(stub);
    const res = await app.request("/skills/sk_1/tools");
    const text = await res.text();
    expect(text).not.toContain("SUPER-SECRET-CALLBACK");
    expect(text).not.toContain("handlerConfig");
    expect(text).not.toContain("inputSchema");
    const body = JSON.parse(text) as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toEqual({ id: "tl_1", name: "Tool tl_1", description: "a tool" });
    expect(body.data[0]).not.toHaveProperty("handlerConfig");
  });

  it("attaches a tool and returns { attached: true }", async () => {
    const stub = makeStub();
    const app = makeBff(stub);
    const res = await postJson(app, "/skills/sk_1/tools", { toolId: "tl_x" });
    expect(res.status).toBe(200);
    expect(stub.calls.attachTool).toHaveBeenCalledWith("sk_1", "tl_x", { tenantId: TENANT });
  });

  it("maps a worker 403 (off-allowlist) to contract `tool_not_allowed`", async () => {
    const stub = makeStub({
      attachTool: async () => {
        throw new BaoBoxError(403, "forbidden", "not permitted to attach tool 'tl_x'", "req_1", null);
      },
    });
    const app = makeBff(stub);
    const res = await postJson(app, "/skills/sk_1/tools", { toolId: "tl_x" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("tool_not_allowed");
  });

  it("detaches a tool (toolId in the path)", async () => {
    const stub = makeStub();
    const app = makeBff(stub);
    const res = await app.request("/skills/sk_1/tools/tl_x", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(stub.calls.detachTool).toHaveBeenCalledWith("sk_1", "tl_x", { tenantId: TENANT });
  });
});

describe("per-tenant parameters", () => {
  const params: SkillParameter[] = [
    { key: "account_id", value: "acct_123" },
    { key: "api_token", value: "tok_SECRET_VALUE", secret: true },
  ];

  it("GET returns an empty list when no parameter store is configured", async () => {
    const stub = makeStub();
    const app = makeBff(stub);
    const res = await app.request("/skills/sk_1/parameters");
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ data: [] });
  });

  it("GET masks secret values (never echoes a secret in cleartext)", async () => {
    const stub = makeStub();
    const app = makeBff(stub, { parameters: { get: async () => params, set: async () => {} } });
    const res = await app.request("/skills/sk_1/parameters");
    const text = await res.text();
    expect(text).not.toContain("tok_SECRET_VALUE");
    const body = (await JSON.parse(text)) as { data: SkillParameter[] };
    expect(body.data.find((p) => p.key === "account_id")?.value).toBe("acct_123");
    expect(body.data.find((p) => p.key === "api_token")?.value).toBe("");
  });

  it("PUT is refused (403) when no parameter store is configured", async () => {
    const stub = makeStub();
    const app = makeBff(stub);
    const res = await putJson(app, "/skills/sk_1/parameters", { parameters: params });
    expect(res.status).toBe(403);
  });

  it("PUT persists via the store, masks the echo, and fires onMutation", async () => {
    const events: SkillMutationEvent[] = [];
    const set = vi.fn(async (p: SkillParameter[]) => p);
    const stub = makeStub();
    const app = makeBff(stub, {
      parameters: { get: async () => [], set },
      onMutation: (e) => void events.push(e),
    });
    const res = await putJson(app, "/skills/sk_1/parameters", { parameters: params });
    expect(res.status).toBe(200);
    expect(set).toHaveBeenCalledWith(params, { tenantId: TENANT, skillId: "sk_1" });
    const text = await res.text();
    expect(text).not.toContain("tok_SECRET_VALUE");
    expect(events).toContainEqual(expect.objectContaining({ op: "setParameters", skillId: "sk_1" }));
  });

  it("PUT rejects an invalid parameter key with 400", async () => {
    const stub = makeStub();
    const app = makeBff(stub, { parameters: { get: async () => [], set: async () => {} } });
    const res = await putJson(app, "/skills/sk_1/parameters", {
      parameters: [{ key: "bad key!", value: "x" }],
    });
    expect(res.status).toBe(400);
  });
});

describe("authz governs every new op (fail-closed)", () => {
  const cases: Array<[string, () => Promise<Response>]> = [];
  function build() {
    const stub = makeStub();
    // fail-closed: no authz hook, no allowUnauthenticated
    const app = createSkillBuilderBff({
      endpoint: "https://baobox.example.com",
      apiKey: "skb_k",
      tenantId: TENANT,
      client: stub.client,
    });
    return { app, stub };
  }

  it("denies create/PUT/attach/detach/tools/parameters with 403 and never calls the SDK", async () => {
    const { app, stub } = build();
    expect((await postJson(app, "/skills", { name: "X", systemPrompt: "p" })).status).toBe(403);
    expect((await putJson(app, "/skills/sk_1", { name: "Y" })).status).toBe(403);
    expect(
      (await postJson(app, "/skills/sk_1/attached-skills", { childSkillId: "sk_2" })).status,
    ).toBe(403);
    expect((await app.request("/skills/sk_1/attached-skills/sk_2", { method: "DELETE" })).status).toBe(403);
    expect((await postJson(app, "/skills/sk_1/tools", { toolId: "tl_1" })).status).toBe(403);
    expect((await app.request("/skills/sk_1/tools/tl_1", { method: "DELETE" })).status).toBe(403);
    expect((await app.request("/skills/sk_1/tools")).status).toBe(403);
    expect((await app.request("/skills/sk_1/attached-skills")).status).toBe(403);
    expect((await app.request("/skills/sk_1/parameters")).status).toBe(403);
    for (const fn of Object.values(stub.calls)) expect(fn).not.toHaveBeenCalled();
    void cases;
  });

  it("passes the detach target ids to the authz hook", async () => {
    const stub = makeStub();
    const authz = vi.fn(() => true);
    const app = makeBff(stub, { authz });
    await app.request("/skills/sk_p/attached-skills/sk_c", { method: "DELETE" });
    expect(authz).toHaveBeenCalledWith({
      op: "detachSkill",
      tenantId: TENANT,
      skillId: "sk_p",
      childSkillId: "sk_c",
    });
    await app.request("/skills/sk_p/tools/tl_c", { method: "DELETE" });
    expect(authz).toHaveBeenCalledWith({
      op: "detachTool",
      tenantId: TENANT,
      skillId: "sk_p",
      toolId: "tl_c",
    });
  });
});

describe("onMutation is best-effort", () => {
  it("a throwing onMutation never fails the request and is audited", async () => {
    const records: AuditRecord[] = [];
    const stub = makeStub({ create: async () => skill("sk_new") });
    const app = makeBff(stub, {
      onMutation: () => {
        throw new Error("git push failed");
      },
      audit: (r) => void records.push(r),
    });
    const res = await postJson(app, "/skills", { name: "X", systemPrompt: "p" });
    expect(res.status).toBe(201);
    expect(records).toContainEqual(
      expect.objectContaining({ op: "create", outcome: "error" }),
    );
  });

  it("isolates a throwing onMutation across structural update, attach, and tool ops", async () => {
    const throwing = {
      onMutation: () => {
        throw new Error("promote-back queue down");
      },
    };
    // structural PUT
    expect((await putJson(makeBff(makeStub(), throwing), "/skills/sk_1", { name: "Z" })).status).toBe(200);
    // attach sub-skill
    expect(
      (await postJson(makeBff(makeStub(), throwing), "/skills/sk_1/attached-skills", { childSkillId: "sk_2" })).status,
    ).toBe(200);
    // attach tool
    expect(
      (await postJson(makeBff(makeStub(), throwing), "/skills/sk_1/tools", { toolId: "tl_1" })).status,
    ).toBe(200);
  });
});

describe("secret hygiene — validation errors never echo a credential (#259 review)", () => {
  it("redacts a credential-named smuggled key from the 400 validation message", async () => {
    const API_KEY = "skb_tenant_key_DO-NOT-LEAK";
    const stub = makeStub();
    // A strict-schema parse reports the unrecognized key in its message; if that
    // key name IS the credential, it must be redacted before it reaches the wire.
    const app = createSkillBuilderBff({
      endpoint: "https://baobox.example.com",
      apiKey: API_KEY,
      tenantId: TENANT,
      client: stub.client,
      allowUnauthenticated: true,
    });
    const res = await postJson(app, "/skills", { name: "X", systemPrompt: "p", [API_KEY]: "v" });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain(API_KEY);
    expect(stub.calls.create).not.toHaveBeenCalled();
  });
});

describe("tenant-scope is threaded on every read (#259 review)", () => {
  it("listAttachedSkills / listTools / getParameters pass { tenantId } to the SDK / store", async () => {
    const stub = makeStub();
    const get = vi.fn(async () => []);
    const app = makeBff(stub, { parameters: { get, set: async () => {} } });
    await app.request("/skills/sk_1/attached-skills");
    await app.request("/skills/sk_1/tools");
    await app.request("/skills/sk_1/parameters");
    expect(stub.calls.listAttachedSkills).toHaveBeenCalledWith("sk_1", { tenantId: TENANT });
    expect(stub.calls.listTools).toHaveBeenCalledWith("sk_1", { tenantId: TENANT });
    expect(get).toHaveBeenCalledWith({ tenantId: TENANT, skillId: "sk_1" });
  });
});

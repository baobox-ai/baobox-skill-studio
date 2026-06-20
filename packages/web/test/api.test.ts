import { describe, expect, it, vi } from "vitest";
import { createApi, SkillStudioApiError } from "../src/api.js";

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(input.toString(), init ?? {})),
  ) as unknown as typeof globalThis.fetch;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const summary = { id: "sk_1", name: "One", description: "d", model: "MiniMax-M2.7", tenantId: "t_1", updatedAt: "x" };
const detail = { ...summary, systemPrompt: "p", temperature: 0.7, maxTokens: 4096, sourceUrl: null, createdAt: "x", files: [] };

describe("createApi", () => {
  it("listSkills GETs {base}/skills and unwraps data — same-origin credentials only", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const api = createApi(
      "https://tenant.example.com/api/skill-studio",
      fakeFetch((url, init) => {
        seen.url = url;
        seen.init = init;
        return json(200, { data: [summary] });
      }),
    );

    const skills = await api.listSkills();
    expect(seen.url).toBe("https://tenant.example.com/api/skill-studio/skills");
    expect(seen.init?.method).toBe("GET");
    // same-origin: the session reaches a same-origin BFF for authz, but the
    // browser never sends cookies cross-origin (and never to BaoBox).
    expect(seen.init?.credentials).toBe("same-origin");
    expect(skills[0]?.id).toBe("sk_1");
  });

  it("throws (no fetch) when apiBase is empty — never falls back to the page origin", () => {
    const fetchSpy = vi.fn();
    expect(() => createApi("", fetchSpy as unknown as typeof globalThis.fetch)).toThrow(/apiBase is required/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes a trailing slash on the base", async () => {
    let url = "";
    const api = createApi(
      "https://x.example.com/bff/",
      fakeFetch((u) => {
        url = u;
        return json(200, { data: [] });
      }),
    );
    await api.listSkills();
    expect(url).toBe("https://x.example.com/bff/skills");
  });

  it("getSkill GETs {base}/skills/:id (encoded)", async () => {
    let url = "";
    const api = createApi(
      "/bff",
      fakeFetch((u) => {
        url = u;
        return json(200, { data: detail });
      }),
    );
    await api.getSkill("sk/space");
    expect(url).toBe("/bff/skills/sk%2Fspace");
  });

  it("updateSkill PATCHes the body and returns the detail", async () => {
    const seen: { method?: string; body?: string } = {};
    const api = createApi(
      "/bff",
      fakeFetch((_u, init) => {
        seen.method = init.method;
        seen.body = init.body as string;
        return json(200, { data: { ...detail, description: "edited" } });
      }),
    );
    const out = await api.updateSkill("sk_1", { description: "edited" });
    expect(seen.method).toBe("PATCH");
    expect(JSON.parse(seen.body ?? "{}")).toEqual({ description: "edited" });
    expect(out.description).toBe("edited");
  });

  it("throws SkillStudioApiError carrying the contract error code/status", async () => {
    const api = createApi(
      "/bff",
      fakeFetch(() => json(404, { error: { code: "not_found", message: "nope" } })),
    );
    await expect(api.getSkill("sk_x")).rejects.toMatchObject({
      name: "SkillStudioApiError",
      status: 404,
      code: "not_found",
    });
    await expect(api.getSkill("sk_x")).rejects.toBeInstanceOf(SkillStudioApiError);
  });
});

describe("createApi — Phase 2 authoring", () => {
  it("createSkill POSTs {base}/skills with the body and returns the detail", async () => {
    const seen: { url?: string; method?: string; body?: string } = {};
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        seen.url = url;
        seen.method = init.method;
        seen.body = init.body as string;
        return json(201, { data: detail });
      }),
    );
    const out = await api.createSkill({ name: "New", systemPrompt: "p" });
    expect(seen.url).toBe("/bff/skills");
    expect(seen.method).toBe("POST");
    expect(JSON.parse(seen.body ?? "{}")).toEqual({ name: "New", systemPrompt: "p" });
    expect(out.id).toBe("sk_1");
  });

  it("updateSkillStructural PUTs {base}/skills/:id", async () => {
    const seen: { url?: string; method?: string; body?: string } = {};
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        seen.url = url;
        seen.method = init.method;
        seen.body = init.body as string;
        return json(200, { data: detail });
      }),
    );
    await api.updateSkillStructural("sk_1", { name: "A", description: "B" });
    expect(seen.url).toBe("/bff/skills/sk_1");
    expect(seen.method).toBe("PUT");
    expect(JSON.parse(seen.body ?? "{}")).toEqual({ name: "A", description: "B" });
  });

  it("attachSubSkill POSTs the childSkillId; detachSubSkill DELETEs the child path", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        calls.push({ url, method: init.method ?? "", body: init.body as string | undefined });
        return json(200, { data: init.method === "POST" ? { attached: true } : { detached: true } });
      }),
    );
    await api.attachSubSkill("sk_p", "sk_c");
    await api.detachSubSkill("sk_p", "sk_c");
    expect(calls[0]).toMatchObject({ url: "/bff/skills/sk_p/attached-skills", method: "POST" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ childSkillId: "sk_c" });
    expect(calls[1]).toMatchObject({ url: "/bff/skills/sk_p/attached-skills/sk_c", method: "DELETE" });
  });

  it("attachTool POSTs the toolId; listTools GETs the tool summaries; detachTool DELETEs the path", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        calls.push({ url, method: init.method ?? "", body: init.body as string | undefined });
        if (init.method === "GET") return json(200, { data: [{ id: "tl_1", name: "T", description: "d" }] });
        return json(200, { data: { attached: true } });
      }),
    );
    await api.attachTool("sk_1", "tl_1");
    const tools = await api.listTools("sk_1");
    await api.detachTool("sk_1", "tl_1");
    expect(calls[0]).toMatchObject({ url: "/bff/skills/sk_1/tools", method: "POST" });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ toolId: "tl_1" });
    expect(tools[0]).toEqual({ id: "tl_1", name: "T", description: "d" });
    expect(calls[2]).toMatchObject({ url: "/bff/skills/sk_1/tools/tl_1", method: "DELETE" });
  });

  it("getParameters GETs and setParameters PUTs { parameters }", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const params = [{ key: "k", value: "v" }];
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        calls.push({ url, method: init.method ?? "", body: init.body as string | undefined });
        return json(200, { data: params });
      }),
    );
    await api.getParameters("sk_1");
    await api.setParameters("sk_1", params);
    expect(calls[0]).toMatchObject({ url: "/bff/skills/sk_1/parameters", method: "GET" });
    expect(calls[1]).toMatchObject({ url: "/bff/skills/sk_1/parameters", method: "PUT" });
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ parameters: params });
  });

  it("surfaces the contract cycle_detected code from a 422", async () => {
    const api = createApi(
      "/bff",
      fakeFetch(() => json(422, { error: { code: "cycle_detected", message: "loop" } })),
    );
    await expect(api.attachSubSkill("sk_a", "sk_b")).rejects.toMatchObject({ status: 422, code: "cycle_detected" });
  });

  it("listAvailableTools GETs {base}/tools and returns the summaries", async () => {
    const seen: { url?: string; method?: string } = {};
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        seen.url = url;
        seen.method = init.method;
        return json(200, { data: [{ id: "tl_1", name: "Web Search", description: "searches the web" }] });
      }),
    );
    const tools = await api.listAvailableTools();
    expect(seen.url).toBe("/bff/tools");
    expect(seen.method).toBe("GET");
    expect(tools).toEqual([{ id: "tl_1", name: "Web Search", description: "searches the web" }]);
  });

  it("listModels GETs {base}/models and returns the catalog (#320)", async () => {
    const seen: { url?: string; method?: string } = {};
    const catalog = {
      providers: [
        {
          id: "openai",
          displayName: "OpenAI",
          defaultModel: "openai/gpt-5",
          docsUrl: "https://platform.openai.com/docs",
          pricingUrl: "https://openai.com/pricing",
          models: [{ id: "openai/gpt-5", displayName: "GPT-5", paramProfile: "reasoning", reasoningEfforts: ["minimal", "low", "medium", "high"] }],
        },
      ],
      reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
    };
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        seen.url = url;
        seen.method = init.method;
        return json(200, catalog);
      }),
    );
    const result = await api.listModels();
    expect(seen.url).toBe("/bff/models");
    expect(seen.method).toBe("GET");
    expect(result.providers).toHaveLength(1);
    expect(result.reasoningEfforts).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("listModels throws SkillStudioApiError on non-2xx (e.g. 401 from apiKey-only BFF)", async () => {
    const api = createApi(
      "/bff",
      fakeFetch(() => json(401, { error: { code: "upstream_error", message: "admin secret required" } })),
    );
    await expect(api.listModels()).rejects.toMatchObject({ status: 401, code: "upstream_error" });
  });

  it("listLlmIntegrations GETs {base}/llm-integrations and unwraps data (#330)", async () => {
    const seen: { url?: string; method?: string } = {};
    const integration = { id: "int_openai", displayName: "OpenAI (tenant)", provider: "openai", defaultModel: "openai/gpt-4o", isDefault: true, apiKeyMask: "sk-...abc" };
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        seen.url = url;
        seen.method = init.method;
        return json(200, { data: [integration] });
      }),
    );
    const integrations = await api.listLlmIntegrations();
    expect(seen.url).toBe("/bff/llm-integrations");
    expect(seen.method).toBe("GET");
    expect(integrations).toHaveLength(1);
    expect(integrations[0]?.id).toBe("int_openai");
  });

  it("listLlmIntegrations returns an empty array when the tenant has no integrations", async () => {
    const api = createApi(
      "/bff",
      fakeFetch(() => json(200, { data: [] })),
    );
    const integrations = await api.listLlmIntegrations();
    expect(integrations).toEqual([]);
  });

  it("listLlmIntegrations throws SkillStudioApiError on non-2xx", async () => {
    const api = createApi(
      "/bff",
      fakeFetch(() => json(403, { error: { code: "forbidden", message: "key lacks grant" } })),
    );
    await expect(api.listLlmIntegrations()).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("listIntegrationModels GETs {base}/llm-integrations/:id/models (URL-encoded) (#330)", async () => {
    const seen: { url?: string; method?: string } = {};
    const view = {
      integrationId: "int_openai",
      provider: "openai",
      models: [
        { id: "openai/gpt-4o", displayName: "GPT-4o", source: "provider", paramProfile: "sampling", reasoningEfforts: null, pricing: null },
      ],
      providerListError: null,
    };
    const api = createApi(
      "/bff",
      fakeFetch((url, init) => {
        seen.url = url;
        seen.method = init.method;
        return json(200, view);
      }),
    );
    const result = await api.listIntegrationModels("int_openai");
    expect(seen.url).toBe("/bff/llm-integrations/int_openai/models");
    expect(seen.method).toBe("GET");
    expect(result.integrationId).toBe("int_openai");
    expect(result.models).toHaveLength(1);
  });

  it("listIntegrationModels URL-encodes a slash in the integrationId", async () => {
    let url = "";
    const api = createApi(
      "/bff",
      fakeFetch((u) => {
        url = u;
        return json(200, { integrationId: "int/x", provider: "p", models: [], providerListError: null });
      }),
    );
    await api.listIntegrationModels("int/x");
    expect(url).toBe("/bff/llm-integrations/int%2Fx/models");
  });

  it("listIntegrationModels surfaces providerListError in the response body", async () => {
    const api = createApi(
      "/bff",
      fakeFetch(() =>
        json(200, { integrationId: "int_openai", provider: "openai", models: [], providerListError: "provider API unreachable" }),
      ),
    );
    const result = await api.listIntegrationModels("int_openai");
    expect(result.providerListError).toBe("provider API unreachable");
  });

  it("listIntegrationModels throws SkillStudioApiError on non-2xx", async () => {
    const api = createApi(
      "/bff",
      fakeFetch(() => json(404, { error: { code: "not_found", message: "integration not found" } })),
    );
    await expect(api.listIntegrationModels("int_bad")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

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
});

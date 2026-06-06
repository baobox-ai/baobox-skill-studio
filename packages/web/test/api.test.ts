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
  it("listSkills GETs {base}/skills and unwraps data — with NO credentials", async () => {
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
    // The browser must NOT send cookies/credentials to the BFF.
    expect(seen.init?.credentials).toBe("omit");
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

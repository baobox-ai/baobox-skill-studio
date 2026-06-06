import type { SkillDetail, SkillSummary } from "../src/api.js";

// An in-memory stand-in for the tenant BFF, implementing the #246 contract.
// Used by the dev harness (no live backend) and by tests. It is excluded from
// the published build.
function seed(): SkillDetail[] {
  const base = (id: string, name: string, description: string, tenantId: string | null): SkillDetail => ({
    id,
    name,
    description,
    systemPrompt: `You are ${name}. Be helpful and concise.`,
    model: "MiniMax-M2.7",
    temperature: 0.7,
    maxTokens: 4096,
    sourceUrl: null,
    tenantId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    files: [{ path: "SKILL.md", size: 128 }],
  });
  return [
    base("sk_chaser", "Invoice Chaser", "Chases overdue invoices politely.", "t_demo"),
    base("sk_triage", "Support Triage", "Routes inbound support messages.", "t_demo"),
    base("sk_default", "Default Assistant", "Platform-wide default skill.", null),
  ];
}

function toSummary(s: SkillDetail): SkillSummary {
  return { id: s.id, name: s.name, description: s.description, model: s.model, tenantId: s.tenantId, updatedAt: s.updatedAt };
}

export interface MockFetchOptions {
  /** Artificial latency (ms) so loading states are visible in the harness. */
  latencyMs?: number;
}

/**
 * Build a `fetch`-compatible function that serves the Skill Studio contract
 * from in-memory data. Matches on the URL pathname, so it works regardless of
 * the `api-base` prefix the element is configured with.
 */
export function createMockFetch(opts: MockFetchOptions = {}): typeof globalThis.fetch {
  const store = seed();
  const latency = opts.latencyMs ?? 0;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (latency) await new Promise((r) => setTimeout(r, latency));
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://mock.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const m = url.pathname.match(/\/skills(?:\/([^/]+))?$/);
    if (!m) return json(404, { error: { code: "not_found", message: "No such route" } });
    const id = m[1] ? decodeURIComponent(m[1]) : undefined;

    if (!id && method === "GET") {
      return json(200, { data: store.map(toSummary) });
    }
    if (id && method === "GET") {
      const found = store.find((s) => s.id === id);
      return found
        ? json(200, { data: found })
        : json(404, { error: { code: "not_found", message: `Skill '${id}' not found` } });
    }
    if (id && method === "PATCH") {
      const found = store.find((s) => s.id === id);
      if (!found) return json(404, { error: { code: "not_found", message: `Skill '${id}' not found` } });
      const patch = (init?.body ? JSON.parse(init.body as string) : {}) as Record<string, unknown>;
      const keys = Object.keys(patch);
      if (keys.length !== 1) {
        return json(400, {
          error: { code: "invalid_request", message: "exactly one editable field is required" },
        });
      }
      Object.assign(found, patch, { updatedAt: "2026-02-02T00:00:00.000Z" });
      return json(200, { data: found });
    }
    return json(405, { error: { code: "method_not_allowed", message: method } });
  }) as typeof globalThis.fetch;
}

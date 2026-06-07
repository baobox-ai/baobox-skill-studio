import type { SkillDetail, SkillParameter, SkillSummary, SkillToolSummary } from "../src/api.js";

// An in-memory stand-in for the tenant BFF, implementing the Skill Studio
// contract (Phase 1 + Phase 2 authoring). Used by the dev harness (no live
// backend). It is excluded from the published build.
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
    // A system skill: read-only + cloneable, to exercise BaoBox#264 Defect B.
    { ...base("sk_guard", "Safety Guard", "Platform guardrail skill.", null), isSystem: 1, cloneable: true },
  ];
}

function toSummary(s: SkillDetail): SkillSummary {
  return { id: s.id, name: s.name, description: s.description, model: s.model, tenantId: s.tenantId, updatedAt: s.updatedAt };
}

// The tenant's tool allowlist (what an apiKey would carry as `tool:<id>`).
const TOOL_CATALOG: SkillToolSummary[] = [
  { id: "tl_search", name: "Web Search", description: "Search the web." },
  { id: "tl_email", name: "Send Email", description: "Send a templated email." },
];
const ALLOWLIST = new Set(TOOL_CATALOG.map((t) => t.id));

export interface MockFetchOptions {
  /** Artificial latency (ms) so loading states are visible in the harness. */
  latencyMs?: number;
}

/**
 * Build a `fetch`-compatible function that serves the Skill Studio contract from
 * in-memory data. Matches on the URL pathname, so it works regardless of the
 * `api-base` prefix the element is configured with.
 */
export function createMockFetch(opts: MockFetchOptions = {}): typeof globalThis.fetch {
  const store = seed();
  const attachments = new Map<string, Set<string>>(); // parentId → childIds
  const tools = new Map<string, Set<string>>(); // skillId → toolIds
  const params = new Map<string, SkillParameter[]>(); // skillId → parameters
  const latency = opts.latencyMs ?? 0;
  let nextId = 1;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const find = (id: string) => store.find((s) => s.id === id);
  const notFound = (id: string) => json(404, { error: { code: "not_found", message: `Skill '${id}' not found` } });

  // Would attaching `child` under `parent` create a cycle? (child reaches parent)
  function wouldCycle(parent: string, child: string): boolean {
    if (parent === child) return true;
    const seen = new Set<string>();
    const stack = [child];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (cur === parent) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const c of attachments.get(cur) ?? []) stack.push(c);
    }
    return false;
  }

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (latency) await new Promise((r) => setTimeout(r, latency));
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://mock.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    const parts = url.pathname.split("/").filter(Boolean);
    const i = parts.lastIndexOf("skills");
    if (i < 0) return json(404, { error: { code: "not_found", message: "No such route" } });
    const seg = parts.slice(i + 1); // after "skills": [], [id], [id, sub], [id, sub, target]
    const id = seg[0] ? decodeURIComponent(seg[0]) : undefined;
    const sub = seg[1];
    const target = seg[2] ? decodeURIComponent(seg[2]) : undefined;

    // /skills
    if (!id) {
      if (method === "GET") return json(200, { data: store.map(toSummary) });
      if (method === "POST") {
        const created: SkillDetail = {
          id: `sk_new_${nextId++}`,
          name: String(body.name ?? "Untitled"),
          description: String(body.description ?? ""),
          systemPrompt: String(body.systemPrompt ?? ""),
          model: String(body.model ?? "MiniMax-M2.7"),
          temperature: Number(body.temperature ?? 0.7),
          maxTokens: Number(body.maxTokens ?? 4096),
          sourceUrl: (body.sourceUrl as string) ?? null,
          tenantId: "t_demo",
          createdAt: "2026-02-02T00:00:00.000Z",
          updatedAt: "2026-02-02T00:00:00.000Z",
          files: [],
        };
        store.push(created);
        return json(201, { data: created });
      }
      return json(405, { error: { code: "validation_error", message: method } });
    }
    const skill = find(id);
    if (!skill) return notFound(id);

    // /skills/:id
    if (!sub) {
      if (method === "GET") return json(200, { data: skill });
      if (method === "PATCH" || method === "PUT") {
        Object.assign(skill, body, { updatedAt: "2026-02-02T00:00:00.000Z" });
        return json(200, { data: skill });
      }
      return json(405, { error: { code: "validation_error", message: method } });
    }

    // /skills/:id/attached-skills[/:childId]
    if (sub === "attached-skills") {
      const set = attachments.get(id) ?? new Set<string>();
      if (method === "GET") {
        return json(200, { data: store.filter((s) => set.has(s.id)).map(toSummary) });
      }
      if (method === "POST") {
        const child = String(body.childSkillId ?? "");
        if (!find(child)) return notFound(child);
        if (wouldCycle(id, child)) {
          return json(422, { error: { code: "cycle_detected", message: "would create a cycle" } });
        }
        set.add(child);
        attachments.set(id, set);
        return json(200, { data: { attached: true } });
      }
      if (method === "DELETE" && target) {
        set.delete(target);
        attachments.set(id, set);
        return json(200, { data: { detached: true } });
      }
    }

    // /skills/:id/tools[/:toolId]
    if (sub === "tools") {
      const set = tools.get(id) ?? new Set<string>();
      if (method === "GET") {
        return json(200, { data: TOOL_CATALOG.filter((t) => set.has(t.id)) });
      }
      if (method === "POST") {
        const toolId = String(body.toolId ?? "");
        if (!ALLOWLIST.has(toolId)) {
          return json(403, { error: { code: "tool_not_allowed", message: `Tool '${toolId}' not permitted` } });
        }
        set.add(toolId);
        tools.set(id, set);
        return json(200, { data: { attached: true } });
      }
      if (method === "DELETE" && target) {
        set.delete(target);
        tools.set(id, set);
        return json(200, { data: { detached: true } });
      }
    }

    // /skills/:id/parameters
    if (sub === "parameters") {
      if (method === "GET") {
        const stored = params.get(id) ?? [];
        // mask secrets, mirroring the BFF
        return json(200, { data: stored.map((p) => (p.secret ? { ...p, value: "" } : p)) });
      }
      if (method === "PUT") {
        const incoming = (body.parameters as SkillParameter[]) ?? [];
        const prev = new Map((params.get(id) ?? []).map((p) => [p.key, p]));
        // Honor the "keep" signal: a secret with a blank value retains the
        // stored secret rather than overwriting it (the host owns the cleartext).
        const next = incoming.map((p) =>
          p.secret && p.value === "" && prev.get(p.key)?.secret ? { ...p, value: prev.get(p.key)?.value ?? "" } : p,
        );
        params.set(id, next);
        return json(200, { data: next.map((p) => (p.secret ? { ...p, value: "" } : p)) });
      }
    }

    return json(405, { error: { code: "validation_error", message: `${method} ${url.pathname}` } });
  }) as typeof globalThis.fetch;
}

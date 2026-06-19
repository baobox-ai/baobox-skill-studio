// The Phase-1 BFF↔MFE HTTP surface. The BFF (#248) mounts handlers for these
// and the Web Component (#249) builds its requests from them — one definition,
// no drift. Paths are relative to the BFF mount point (the `api-base` the host
// configures on `<baobox-skill-builder>`); they intentionally do NOT include
// the BaoBox `/api/v1` prefix — this is the tenant BFF's own surface.
//
// HTTP method + path semantics for Phase 1 (walking skeleton):
//   GET   /skills        → ListSkillsResponse   (list, lean summaries)
//   GET   /skills/:id    → SkillDetailResponse  (one skill + file refs)
//   PATCH /skills/:id    → SkillDetailResponse  (single-field edit)
export const SKILL_STUDIO_BASE_PATH = "/skills" as const;

//
// Phase 2 (#258) ADDS the authoring ops below. All additive — the three Phase-1
// entries keep their exact method+path so existing builds don't drift:
//   POST   /skills                         → SkillDetailResponse   (create, tenant-owned)
//   PUT    /skills/:id                      → SkillDetailResponse   (structural multi-field update)
//   GET    /skills/:id/attached-skills      → ListAttachedSkillsResponse
//   POST   /skills/:id/attached-skills      → AttachAckResponse     (body: { childSkillId })
//   DELETE /skills/:id/attached-skills/:childId → DetachAckResponse
//   GET    /skills/:id/tools                → ListSkillToolsResponse
//   POST   /skills/:id/tools                → AttachAckResponse     (body: { toolId })
//   DELETE /skills/:id/tools/:toolId        → DetachAckResponse
//   GET    /skills/:id/parameters           → { data: SkillParameter[] }
//   PUT    /skills/:id/parameters           → { data: SkillParameter[] } (body: { parameters })
const enc = encodeURIComponent;

export const skillStudioRoutes = {
  listSkills: {
    method: "GET",
    path: "/skills",
  },
  getSkill: {
    method: "GET",
    path: "/skills/:id",
    build: (id: string): string => `/skills/${encodeURIComponent(id)}`,
  },
  // Phase-1 single-field edit (unchanged).
  updateSkill: {
    method: "PATCH",
    path: "/skills/:id",
    build: (id: string): string => `/skills/${encodeURIComponent(id)}`,
  },
  // Phase 2 — create (tenant-owned).
  createSkill: {
    method: "POST",
    path: "/skills",
  },
  // Phase 2 — structural multi-field update.
  updateSkillStructural: {
    method: "PUT",
    path: "/skills/:id",
    build: (id: string): string => `/skills/${enc(id)}`,
  },
  // Phase 2 — orchestrator sub-skill graph.
  listAttachedSkills: {
    method: "GET",
    path: "/skills/:id/attached-skills",
    build: (id: string): string => `/skills/${enc(id)}/attached-skills`,
  },
  attachSubSkill: {
    method: "POST",
    path: "/skills/:id/attached-skills",
    build: (id: string): string => `/skills/${enc(id)}/attached-skills`,
  },
  detachSubSkill: {
    method: "DELETE",
    path: "/skills/:id/attached-skills/:childId",
    build: (id: string, childId: string): string =>
      `/skills/${enc(id)}/attached-skills/${enc(childId)}`,
  },
  // Phase 2 — tool wiring.
  listSkillTools: {
    method: "GET",
    path: "/skills/:id/tools",
    build: (id: string): string => `/skills/${enc(id)}/tools`,
  },
  attachTool: {
    method: "POST",
    path: "/skills/:id/tools",
    build: (id: string): string => `/skills/${enc(id)}/tools`,
  },
  detachTool: {
    method: "DELETE",
    path: "/skills/:id/tools/:toolId",
    build: (id: string, toolId: string): string => `/skills/${enc(id)}/tools/${enc(toolId)}`,
  },
  // Phase 2 — per-tenant parameters.
  getSkillParameters: {
    method: "GET",
    path: "/skills/:id/parameters",
    build: (id: string): string => `/skills/${enc(id)}/parameters`,
  },
  setSkillParameters: {
    method: "PUT",
    path: "/skills/:id/parameters",
    build: (id: string): string => `/skills/${enc(id)}/parameters`,
  },
  // Phase 3 — tenant tool allowlist enumeration (own + global tools the tenant
  // may attach). Distinct from `listSkillTools` (attached tools for a skill).
  // Path is `/tools` — does NOT include `/skills/:id` — because it is not
  // scoped to a particular skill.
  listAvailableTools: {
    method: "GET",
    path: "/tools",
  },
  // #320 — live LLM model catalog. Path `/models` is distinct from all skill
  // and tool paths. The BFF calls `client.catalog.list()` (ADMIN_SECRET-gated);
  // an apiKey-only BFF gets 401 and the web falls back to the static catalog.
  listModels: {
    method: "GET",
    path: "/models",
  },
} as const;

export type SkillStudioRoutes = typeof skillStudioRoutes;

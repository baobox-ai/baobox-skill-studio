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
  updateSkill: {
    method: "PATCH",
    path: "/skills/:id",
    build: (id: string): string => `/skills/${encodeURIComponent(id)}`,
  },
} as const;

export type SkillStudioRoutes = typeof skillStudioRoutes;

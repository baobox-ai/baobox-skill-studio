import {
  type ListSkillsResponse,
  type SkillDetail,
  type SkillDetailResponse,
  type SkillSummary,
  type SkillUpdateRequest,
  skillStudioRoutes,
} from "@baobox/skill-builder-contract";

export type { SkillDetail, SkillSummary, SkillUpdateRequest } from "@baobox/skill-builder-contract";

export class SkillStudioApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SkillStudioApiError";
    this.status = status;
    this.code = code;
  }
}

/** The data surface the Web Component depends on — the #246 contract, nothing else. */
export interface SkillStudioApi {
  listSkills(): Promise<SkillSummary[]>;
  getSkill(id: string): Promise<SkillDetail>;
  updateSkill(id: string, body: SkillUpdateRequest): Promise<SkillDetail>;
}

type FetchFn = typeof globalThis.fetch;

/**
 * Build an API client bound to a configurable `apiBase` — the tenant BFF, NOT
 * BaoBox. Deliberately uses **no** credentials/cookies: the BFF is the auth
 * boundary, so the browser never carries a BaoBox session or secret. All paths
 * come from the shared `@baobox/skill-builder-contract` route descriptors.
 */
export function createApi(apiBase: string, fetchImpl?: FetchFn): SkillStudioApi {
  const base = apiBase.replace(/\/+$/, "");
  if (!base) {
    // Refuse to fall back to the embedding page's origin — that could be BaoBox
    // itself. The host must point `api-base` at its own BFF.
    throw new Error("@baobox/skill-builder: apiBase is required (the tenant BFF base URL)");
  }
  // Bind to globalThis so an unbound `fetch` reference doesn't throw "Illegal
  // invocation" in browsers.
  const doFetch: FetchFn = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      // `same-origin`: send the host's tenant session ONLY to a same-origin BFF
      // (the recommended setup) so the BFF's authz hook can identify the user —
      // never cross-origin, and never to BaoBox (the element never calls it). A
      // cross-origin BFF gets no cookies and must use a non-cookie auth path.
      credentials: "same-origin",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = {};
      }
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } }).error ?? {};
      throw new SkillStudioApiError(
        res.status,
        err.code ?? "error",
        err.message ?? `${res.status} ${res.statusText}`,
      );
    }
    return json as T;
  }

  return {
    async listSkills() {
      const body = await request<ListSkillsResponse>("GET", skillStudioRoutes.listSkills.path);
      return body.data;
    },
    async getSkill(id) {
      const body = await request<SkillDetailResponse>("GET", skillStudioRoutes.getSkill.build(id));
      return body.data;
    },
    async updateSkill(id, update) {
      const body = await request<SkillDetailResponse>(
        skillStudioRoutes.updateSkill.method,
        skillStudioRoutes.updateSkill.build(id),
        update,
      );
      return body.data;
    },
  };
}

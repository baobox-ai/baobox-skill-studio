import {
  type AttachAckResponse,
  type DetachAckResponse,
  type ListAttachedSkillsResponse,
  type ListAvailableToolsResponse,
  type ListSkillsResponse,
  type ListSkillToolsResponse,
  type ModelCatalogResponse,
  type SkillCreateRequest,
  type SkillDetail as ContractSkillDetail,
  type SkillDetailResponse,
  type SkillParameter,
  type SkillStructuralUpdateRequest,
  type SkillSummary,
  type SkillToolSummary,
  type SkillUpdateRequest,
  skillStudioRoutes,
} from "@baobox/skill-builder-contract";

export type {
  ModelCatalogResponse,
  SkillCreateRequest,
  SkillParameter,
  SkillStructuralUpdateRequest,
  SkillSummary,
  SkillToolSummary,
  SkillUpdateRequest,
} from "@baobox/skill-builder-contract";

/**
 * The detail shape the UI renders. It is the contract's `SkillDetail` plus two
 * fields that ride through on the wire as additive, runtime-only properties:
 *
 *   isSystem  — `1` for a platform/system skill (read-only for a tenant), else `0`.
 *   cloneable — `true` iff this is a system skill a tenant may copy as its own.
 *
 * BaoBox#264 added them to the worker's skill wire contract; the SDK and BFF pass
 * unknown response fields through verbatim (neither strips), so they arrive here
 * even though the published contract type does not yet declare them. They are
 * OPTIONAL — a worker without #264 simply omits them and the UI treats the skill
 * as a normal editable tenant skill.
 */
export type SkillDetail = ContractSkillDetail & {
  isSystem?: number;
  cloneable?: boolean;
};

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

/** The data surface the Web Component depends on — the contract, nothing else. */
export interface SkillStudioApi {
  // Phase 1 — reads + single-field edit.
  listSkills(): Promise<SkillSummary[]>;
  getSkill(id: string): Promise<SkillDetail>;
  updateSkill(id: string, body: SkillUpdateRequest): Promise<SkillDetail>;
  // Phase 2 — authoring.
  createSkill(body: SkillCreateRequest): Promise<SkillDetail>;
  updateSkillStructural(id: string, body: SkillStructuralUpdateRequest): Promise<SkillDetail>;
  listAttachedSkills(id: string): Promise<SkillSummary[]>;
  attachSubSkill(id: string, childSkillId: string): Promise<void>;
  detachSubSkill(id: string, childSkillId: string): Promise<void>;
  listTools(id: string): Promise<SkillToolSummary[]>;
  attachTool(id: string, toolId: string): Promise<void>;
  detachTool(id: string, toolId: string): Promise<void>;
  getParameters(id: string): Promise<SkillParameter[]>;
  setParameters(id: string, parameters: SkillParameter[]): Promise<SkillParameter[]>;
  // Phase 3 — available tool picker (#312).
  /** Return the tenant's attachable tool allowlist (own + global). */
  listAvailableTools(): Promise<SkillToolSummary[]>;
  // #320 — live LLM model catalog.
  /**
   * Fetch the live LLM model catalog from the BFF (`GET /models`).
   * ADMIN_SECRET-gated on the BFF side — an apiKey-only BFF returns an error,
   * in which case the caller should fall back to the static catalog.
   */
  listModels(): Promise<ModelCatalogResponse>;
}

type FetchFn = typeof globalThis.fetch;

/**
 * Build an API client bound to a configurable `apiBase` — the tenant BFF, NOT
 * BaoBox. Deliberately uses **no** credentials/cookies beyond the same-origin
 * session: the BFF is the auth boundary, so the browser never carries a BaoBox
 * session or secret. All paths come from the shared
 * `@baobox/skill-builder-contract` route descriptors.
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
      return body.data as SkillDetail;
    },
    async updateSkill(id, update) {
      const body = await request<SkillDetailResponse>(
        skillStudioRoutes.updateSkill.method,
        skillStudioRoutes.updateSkill.build(id),
        update,
      );
      return body.data as SkillDetail;
    },
    async createSkill(req) {
      const body = await request<SkillDetailResponse>(
        skillStudioRoutes.createSkill.method,
        skillStudioRoutes.createSkill.path,
        req,
      );
      return body.data as SkillDetail;
    },
    async updateSkillStructural(id, update) {
      const body = await request<SkillDetailResponse>(
        skillStudioRoutes.updateSkillStructural.method,
        skillStudioRoutes.updateSkillStructural.build(id),
        update,
      );
      return body.data as SkillDetail;
    },
    async listAttachedSkills(id) {
      const body = await request<ListAttachedSkillsResponse>(
        skillStudioRoutes.listAttachedSkills.method,
        skillStudioRoutes.listAttachedSkills.build(id),
      );
      return body.data;
    },
    async attachSubSkill(id, childSkillId) {
      await request<AttachAckResponse>(
        skillStudioRoutes.attachSubSkill.method,
        skillStudioRoutes.attachSubSkill.build(id),
        { childSkillId },
      );
    },
    async detachSubSkill(id, childSkillId) {
      await request<DetachAckResponse>(
        skillStudioRoutes.detachSubSkill.method,
        skillStudioRoutes.detachSubSkill.build(id, childSkillId),
      );
    },
    async listTools(id) {
      const body = await request<ListSkillToolsResponse>(
        skillStudioRoutes.listSkillTools.method,
        skillStudioRoutes.listSkillTools.build(id),
      );
      return body.data;
    },
    async attachTool(id, toolId) {
      await request<AttachAckResponse>(
        skillStudioRoutes.attachTool.method,
        skillStudioRoutes.attachTool.build(id),
        { toolId },
      );
    },
    async detachTool(id, toolId) {
      await request<DetachAckResponse>(
        skillStudioRoutes.detachTool.method,
        skillStudioRoutes.detachTool.build(id, toolId),
      );
    },
    async getParameters(id) {
      const body = await request<{ data: SkillParameter[] }>(
        skillStudioRoutes.getSkillParameters.method,
        skillStudioRoutes.getSkillParameters.build(id),
      );
      return body.data;
    },
    async setParameters(id, parameters) {
      const body = await request<{ data: SkillParameter[] }>(
        skillStudioRoutes.setSkillParameters.method,
        skillStudioRoutes.setSkillParameters.build(id),
        { parameters },
      );
      return body.data;
    },
    async listAvailableTools() {
      const body = await request<ListAvailableToolsResponse>(
        skillStudioRoutes.listAvailableTools.method,
        skillStudioRoutes.listAvailableTools.path,
      );
      return body.data;
    },
    async listModels() {
      return request<ModelCatalogResponse>(
        skillStudioRoutes.listModels.method,
        skillStudioRoutes.listModels.path,
      );
    },
  };
}

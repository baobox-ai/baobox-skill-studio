import type { DecisionSkillSpec, LlmIntegration, ModelRole, Skill, SkillWithFiles } from "@baobox/sdk";
import { describe, expect, it } from "vitest";
import {
  MODEL_ROLES,
  REASONING_EFFORT_VALUES,
  ROLE_MODEL_MODES,
  SKILL_KINDS,
  isDecisionSkill,
  listLlmIntegrationsResponseSchema,
  llmIntegrationSchema,
  skillRoleModelsMapSchema,
  attachSubSkillRequestSchema,
  attachToolRequestSchema,
  contractErrorSchema,
  listSkillsResponseSchema,
  modelCatalogResponseSchema,
  modelRoleSchema,
  putRoleModelsRequestSchema,
  reasoningEffortSchema,
  setSkillParametersRequestSchema,
  skillCreateRequestSchema,
  skillDetailResponseSchema,
  skillDetailSchema,
  skillParameterSchema,
  skillStructuralUpdateRequestSchema,
  skillStudioRoutes,
  skillSummarySchema,
  skillUpdateRequestSchema,
  toSkillSummary,
} from "../src/index.js";

const sdkSkill: Skill = {
  id: "sk_demo",
  name: "Demo",
  description: "A demo skill",
  systemPrompt: "You are a demo.",
  model: "MiniMax-M2.7",
  temperature: 0.7,
  maxTokens: 4096,
  sourceUrl: null,
  tenantId: "t_acme",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const sdkSkillWithFiles: SkillWithFiles = {
  ...sdkSkill,
  files: [{ path: "SKILL.md", size: 123 }],
};

describe("skillSummarySchema", () => {
  it("accepts a projection of an @baobox/sdk Skill", () => {
    const summary = toSkillSummary(sdkSkill);
    expect(skillSummarySchema.parse(summary)).toEqual(summary);
  });

  it("accepts a null tenantId (global skill)", () => {
    const summary = toSkillSummary({ ...sdkSkill, tenantId: null });
    expect(summary.tenantId).toBeNull();
    expect(skillSummarySchema.safeParse(summary).success).toBe(true);
  });
});

describe("skillDetailSchema", () => {
  it("validates an @baobox/sdk SkillWithFiles verbatim", () => {
    const parsed = skillDetailSchema.parse(sdkSkillWithFiles);
    expect(parsed).toEqual(sdkSkillWithFiles);
  });

  it("rejects a payload missing files", () => {
    const { files: _files, ...noFiles } = sdkSkillWithFiles;
    expect(skillDetailSchema.safeParse(noFiles).success).toBe(false);
  });
});

describe("skillUpdateRequestSchema", () => {
  it("accepts a single-field edit", () => {
    expect(skillUpdateRequestSchema.safeParse({ description: "new" }).success).toBe(true);
  });

  it("rejects multiple fields (Phase 1 is single-field)", () => {
    const r = skillUpdateRequestSchema.safeParse({ name: "X", systemPrompt: "Y" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty body (no fields)", () => {
    expect(skillUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown / non-editable keys (e.g. tenantId, id)", () => {
    expect(skillUpdateRequestSchema.safeParse({ tenantId: "t_x" }).success).toBe(false);
    expect(
      skillUpdateRequestSchema.safeParse({ id: "sk_other", description: "x" }).success,
    ).toBe(false);
  });

  it("rejects out-of-range temperature", () => {
    expect(skillUpdateRequestSchema.safeParse({ temperature: 5 }).success).toBe(false);
  });

  it("accepts reasoningEffort as a single-field edit", () => {
    for (const effort of REASONING_EFFORT_VALUES) {
      expect(skillUpdateRequestSchema.safeParse({ reasoningEffort: effort }).success).toBe(true);
    }
  });

  it("rejects an invalid reasoningEffort value", () => {
    expect(skillUpdateRequestSchema.safeParse({ reasoningEffort: "ultra" }).success).toBe(false);
    expect(skillUpdateRequestSchema.safeParse({ reasoningEffort: "max" }).success).toBe(false);
  });
});

describe("reasoningEffortSchema", () => {
  it("accepts all six tiers (full OpenAI set)", () => {
    expect(REASONING_EFFORT_VALUES).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
    for (const tier of REASONING_EFFORT_VALUES) {
      expect(reasoningEffortSchema.safeParse(tier).success).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(reasoningEffortSchema.safeParse("ultra").success).toBe(false);
    expect(reasoningEffortSchema.safeParse("").success).toBe(false);
  });
});

describe("skillDetailSchema with reasoningEffort", () => {
  it("accepts a skill without reasoningEffort (sampling model)", () => {
    const r = skillDetailSchema.safeParse(sdkSkillWithFiles);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reasoningEffort).toBeUndefined();
  });

  it("accepts a skill with a valid reasoningEffort (reasoning model)", () => {
    const r = skillDetailSchema.safeParse({ ...sdkSkillWithFiles, reasoningEffort: "high" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reasoningEffort).toBe("high");
  });

  it("rejects an invalid reasoningEffort value", () => {
    const r = skillDetailSchema.safeParse({ ...sdkSkillWithFiles, reasoningEffort: "max" });
    expect(r.success).toBe(false);
  });
});

describe("response envelopes", () => {
  it("listSkillsResponseSchema wraps an array of summaries", () => {
    const r = listSkillsResponseSchema.safeParse({ data: [toSkillSummary(sdkSkill)] });
    expect(r.success).toBe(true);
  });

  it("skillDetailResponseSchema wraps a detail", () => {
    const r = skillDetailResponseSchema.safeParse({ data: sdkSkillWithFiles });
    expect(r.success).toBe(true);
  });
});

describe("skillStudioRoutes", () => {
  it("exposes the three Phase-1 ops with correct methods", () => {
    expect(skillStudioRoutes.listSkills).toEqual({ method: "GET", path: "/skills" });
    expect(skillStudioRoutes.getSkill.method).toBe("GET");
    expect(skillStudioRoutes.updateSkill.method).toBe("PATCH");
  });

  it("builds id paths with encoding", () => {
    expect(skillStudioRoutes.getSkill.build("sk_1")).toBe("/skills/sk_1");
    expect(skillStudioRoutes.updateSkill.build("a/b")).toBe("/skills/a%2Fb");
  });

  // #258 — Phase 1 routes are unchanged (backward compatibility).
  it("keeps the Phase-1 single-field PATCH route intact", () => {
    expect(skillStudioRoutes.updateSkill).toMatchObject({ method: "PATCH", path: "/skills/:id" });
  });
});

// ===========================================================================
// Phase 2 (#258) — authoring surface
// ===========================================================================

describe("Phase-2 routes", () => {
  it("exposes create (POST) and structural update (PUT) on /skills[/:id]", () => {
    expect(skillStudioRoutes.createSkill).toEqual({ method: "POST", path: "/skills" });
    expect(skillStudioRoutes.updateSkillStructural).toMatchObject({
      method: "PUT",
      path: "/skills/:id",
    });
    expect(skillStudioRoutes.updateSkillStructural.build("sk_1")).toBe("/skills/sk_1");
  });

  it("exposes sub-skill graph routes with correct methods + encoded builders", () => {
    expect(skillStudioRoutes.listAttachedSkills.method).toBe("GET");
    expect(skillStudioRoutes.attachSubSkill).toMatchObject({
      method: "POST",
      path: "/skills/:id/attached-skills",
    });
    expect(skillStudioRoutes.attachSubSkill.build("sk_1")).toBe("/skills/sk_1/attached-skills");
    expect(skillStudioRoutes.detachSubSkill.method).toBe("DELETE");
    expect(skillStudioRoutes.detachSubSkill.build("a/b", "c/d")).toBe(
      "/skills/a%2Fb/attached-skills/c%2Fd",
    );
  });

  it("exposes tool routes with correct methods + encoded builders", () => {
    expect(skillStudioRoutes.attachTool).toMatchObject({
      method: "POST",
      path: "/skills/:id/tools",
    });
    expect(skillStudioRoutes.attachTool.build("sk_1")).toBe("/skills/sk_1/tools");
    expect(skillStudioRoutes.detachTool.method).toBe("DELETE");
    expect(skillStudioRoutes.detachTool.build("sk_1", "tool_x")).toBe("/skills/sk_1/tools/tool_x");
  });

  it("exposes per-tenant parameter routes", () => {
    expect(skillStudioRoutes.getSkillParameters.method).toBe("GET");
    expect(skillStudioRoutes.setSkillParameters).toMatchObject({
      method: "PUT",
      path: "/skills/:id/parameters",
    });
    expect(skillStudioRoutes.setSkillParameters.build("sk_1")).toBe("/skills/sk_1/parameters");
  });
});

describe("skillCreateRequestSchema", () => {
  it("accepts a minimal create (name + systemPrompt)", () => {
    expect(skillCreateRequestSchema.safeParse({ name: "n", systemPrompt: "p" }).success).toBe(true);
  });

  it("rejects a missing systemPrompt", () => {
    expect(skillCreateRequestSchema.safeParse({ name: "n" }).success).toBe(false);
  });

  it("rejects unknown keys (no smuggling tenantId / tools)", () => {
    expect(
      skillCreateRequestSchema.safeParse({ name: "n", systemPrompt: "p", tenantId: "t_x" }).success,
    ).toBe(false);
    expect(
      skillCreateRequestSchema.safeParse({ name: "n", systemPrompt: "p", tools: ["t"] }).success,
    ).toBe(false);
  });
});

describe("skillStructuralUpdateRequestSchema", () => {
  it("accepts MULTIPLE fields (unlike Phase-1 single-field PATCH)", () => {
    expect(
      skillStructuralUpdateRequestSchema.safeParse({ name: "X", systemPrompt: "Y" }).success,
    ).toBe(true);
  });

  it("rejects an empty body", () => {
    expect(skillStructuralUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown / non-editable keys", () => {
    expect(skillStructuralUpdateRequestSchema.safeParse({ id: "sk_x", name: "Y" }).success).toBe(
      false,
    );
  });
});

describe("attach request schemas", () => {
  it("attachSubSkillRequestSchema requires childSkillId", () => {
    expect(attachSubSkillRequestSchema.safeParse({ childSkillId: "sk_c" }).success).toBe(true);
    expect(attachSubSkillRequestSchema.safeParse({}).success).toBe(false);
    expect(
      attachSubSkillRequestSchema.safeParse({ childSkillId: "sk_c", extra: 1 }).success,
    ).toBe(false);
  });

  it("attachToolRequestSchema requires toolId", () => {
    expect(attachToolRequestSchema.safeParse({ toolId: "tool_x" }).success).toBe(true);
    expect(attachToolRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("per-tenant parameters", () => {
  it("accepts a valid parameter (alnum key)", () => {
    expect(skillParameterSchema.safeParse({ key: "account_id", value: "123" }).success).toBe(true);
  });

  it("rejects a key with illegal characters", () => {
    expect(skillParameterSchema.safeParse({ key: "bad-key!", value: "x" }).success).toBe(false);
  });

  it("accepts a list of parameters", () => {
    const r = setSkillParametersRequestSchema.safeParse({
      parameters: [
        { key: "a", value: "1" },
        { key: "b", value: "", secret: true, label: "Token" },
      ],
    });
    expect(r.success).toBe(true);
  });
});

// ===========================================================================
// #312 — Phase 3: listAvailableTools route
// ===========================================================================

describe("listAvailableTools route (#312)", () => {
  it("exposes GET /tools in the route table", () => {
    expect(skillStudioRoutes.listAvailableTools).toEqual({ method: "GET", path: "/tools" });
  });
});

// ===========================================================================
// #320 — Live LLM model catalog
// ===========================================================================

describe("REASONING_EFFORT_VALUES drift-guard (#320)", () => {
  // mirror of backend REASONING_EFFORTS — keep in sync;
  // this test fails if the contract tuple drifts from the backend master list.
  const BACKEND_MASTER_TUPLE = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

  it("contract REASONING_EFFORT_VALUES equals the backend master tuple", () => {
    expect(Array.from(REASONING_EFFORT_VALUES)).toEqual(Array.from(BACKEND_MASTER_TUPLE));
  });
});

describe("listModels route (#320)", () => {
  it("exposes GET /models in the route table", () => {
    expect(skillStudioRoutes.listModels).toEqual({ method: "GET", path: "/models" });
  });
});

describe("modelCatalogResponseSchema (#320)", () => {
  it("accepts a well-formed catalog response", () => {
    const catalog = {
      providers: [
        {
          id: "openai",
          displayName: "OpenAI",
          defaultModel: "openai/gpt-5",
          docsUrl: "https://platform.openai.com/docs",
          pricingUrl: "https://openai.com/pricing",
          models: [
            {
              id: "openai/gpt-5",
              displayName: "GPT-5",
              paramProfile: "reasoning",
              reasoningEfforts: ["minimal", "low", "medium", "high"],
              contextWindow: 128000,
            },
            {
              id: "openai/gpt-4o",
              displayName: "GPT-4o",
              paramProfile: "sampling",
            },
          ],
        },
      ],
      reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
    };
    const r = modelCatalogResponseSchema.safeParse(catalog);
    expect(r.success).toBe(true);
  });

  it("accepts an empty providers list", () => {
    const r = modelCatalogResponseSchema.safeParse({ providers: [], reasoningEfforts: [] });
    expect(r.success).toBe(true);
  });

  it("accepts a model without optional fields (contextWindow, pricing, reasoningEfforts)", () => {
    const r = modelCatalogResponseSchema.safeParse({
      providers: [
        {
          id: "minimax",
          displayName: "MiniMax",
          defaultModel: "minimax/MiniMax-M2.7",
          docsUrl: "https://docs.minimax.io",
          pricingUrl: "https://minimax.io/pricing",
          models: [{ id: "minimax/MiniMax-M2.7", displayName: "MiniMax M2.7", paramProfile: "sampling" }],
        },
      ],
      reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid paramProfile", () => {
    const r = modelCatalogResponseSchema.safeParse({
      providers: [
        {
          id: "x",
          displayName: "X",
          defaultModel: "x/m",
          docsUrl: "https://x.example",
          pricingUrl: "https://x.example/pricing",
          models: [{ id: "x/m", displayName: "M", paramProfile: "unknown" }],
        },
      ],
      reasoningEfforts: [],
    });
    expect(r.success).toBe(false);
  });
});

// ===========================================================================
// #328 — Per-role guard model config
// ===========================================================================

describe("MODEL_ROLES drift-guard (#328)", () => {
  // Mirror of the SDK ModelRole union — keeps the contract in sync with the SDK.
  // If the SDK adds or removes a role, update MODEL_ROLES and this assertion.
  const SDK_MODEL_ROLES: readonly ModelRole[] = [
    "main",
    "preflight_guard",
    "postflight_guard",
    "eval_judge",
  ];

  it("MODEL_ROLES equals the SDK ModelRole union members", () => {
    expect(Array.from(MODEL_ROLES)).toEqual(Array.from(SDK_MODEL_ROLES));
  });
});

describe("getRoleModels / putRoleModels routes (#328)", () => {
  it("exposes GET /skills/:id/role-models in the route table", () => {
    expect(skillStudioRoutes.getRoleModels.method).toBe("GET");
    expect(skillStudioRoutes.getRoleModels.path).toBe("/skills/:id/role-models");
    expect(skillStudioRoutes.getRoleModels.build("sk_1")).toBe("/skills/sk_1/role-models");
    expect(skillStudioRoutes.getRoleModels.build("a/b")).toBe("/skills/a%2Fb/role-models");
  });

  it("exposes PUT /skills/:id/role-models in the route table", () => {
    expect(skillStudioRoutes.putRoleModels.method).toBe("PUT");
    expect(skillStudioRoutes.putRoleModels.path).toBe("/skills/:id/role-models");
    expect(skillStudioRoutes.putRoleModels.build("sk_1")).toBe("/skills/sk_1/role-models");
  });
});

describe("modelRoleSchema (#328)", () => {
  it("accepts every valid role", () => {
    for (const role of MODEL_ROLES) {
      expect(modelRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("rejects an unknown role string", () => {
    expect(modelRoleSchema.safeParse("main_guard").success).toBe(false);
    expect(modelRoleSchema.safeParse("").success).toBe(false);
  });
});

describe("putRoleModelsRequestSchema (#328)", () => {
  it("accepts a valid put body with a tenant-default chain entry (what Studio sends)", () => {
    const r = putRoleModelsRequestSchema.safeParse({
      role: "preflight_guard",
      chain: [{ llmIntegrationId: null, model: "openai/gpt-5", llmSource: "tenant_default", mode: "chat" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an empty chain (clear / inherit tenant default)", () => {
    const r = putRoleModelsRequestSchema.safeParse({ role: "main", chain: [] });
    expect(r.success).toBe(true);
  });

  it("accepts a chain of up to 4 entries", () => {
    const entry = { llmIntegrationId: null, model: "openai/gpt-4o", llmSource: "tenant_default" as const };
    const r = putRoleModelsRequestSchema.safeParse({
      role: "postflight_guard",
      chain: [entry, entry, entry, entry],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a chain exceeding 4 entries", () => {
    const entry = { llmIntegrationId: null, model: "m", llmSource: "tenant_default" as const };
    const r = putRoleModelsRequestSchema.safeParse({
      role: "preflight_guard",
      chain: [entry, entry, entry, entry, entry],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const r = putRoleModelsRequestSchema.safeParse({
      role: "mystery_role",
      chain: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown llmSource", () => {
    const r = putRoleModelsRequestSchema.safeParse({
      role: "main",
      chain: [{ llmIntegrationId: null, model: "m", llmSource: "custom" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (.strict())", () => {
    const r = putRoleModelsRequestSchema.safeParse({
      role: "main",
      chain: [],
      extra: "field",
    });
    expect(r.success).toBe(false);
  });
});

describe("contractErrorSchema", () => {
  it("accepts each defined error code", () => {
    for (const code of [
      "validation_error",
      "cycle_detected",
      "tool_not_allowed",
      "forbidden",
      "not_found",
      "conflict",
      "upstream_error",
      "internal_error",
    ]) {
      const r = contractErrorSchema.safeParse({ error: { code, message: "x" } });
      expect(r.success).toBe(true);
    }
  });

  it("rejects an unknown error code", () => {
    expect(
      contractErrorSchema.safeParse({ error: { code: "teapot", message: "x" } }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 0.8.0 — SDK 0.32.0 surfaces (baobox#846): role-model `mode`, decision skills,
// nullable integration `defaultModel`.
// ---------------------------------------------------------------------------

const decisionSpec: DecisionSkillSpec = {
  version: 1,
  questions: [
    { id: "urgent", type: "boolean", prompt: "Is the message urgent?" },
    {
      id: "topic",
      type: "choice",
      prompt: "What is it about?",
      options: [
        { value: "billing", description: "Invoices and payments" },
        { value: "other", description: "Anything else" },
      ],
    },
  ],
  state: { history: 0 },
};

const sdkDecisionSkill: SkillWithFiles = {
  ...sdkSkillWithFiles,
  id: "sk_decide",
  systemPrompt: "Triage inbound support email.",
  skillKind: "decision",
  decisionSpec,
  files: [],
};

describe("roleModelChainEntrySchema — mode (0.8.0)", () => {
  it("accepts mode: chat and mode: decision on an entry", () => {
    for (const mode of ROLE_MODEL_MODES) {
      const r = putRoleModelsRequestSchema.safeParse({
        role: "preflight_guard",
        chain: [{ llmIntegrationId: "tllm_1", model: null, llmSource: "pinned", mode }],
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.chain[0]?.mode).toBe(mode);
    }
  });

  it("keeps an omitted mode omitted (no default injected — the server infers it)", () => {
    const r = putRoleModelsRequestSchema.parse({
      role: "preflight_guard",
      chain: [{ llmIntegrationId: "tllm_1", model: "gpt-5.4", llmSource: "pinned" }],
    });
    expect("mode" in (r.chain[0] ?? {})).toBe(false);
  });

  it("rejects an unknown mode", () => {
    const r = putRoleModelsRequestSchema.safeParse({
      role: "preflight_guard",
      chain: [{ llmIntegrationId: "tllm_1", model: null, llmSource: "pinned", mode: "judge" }],
    });
    expect(r.success).toBe(false);
  });

  it("is still .strict(): an unknown key on a chain entry is rejected", () => {
    const r = putRoleModelsRequestSchema.safeParse({
      role: "preflight_guard",
      chain: [{ llmIntegrationId: null, model: "m", llmSource: "tenant_default", mode: "chat", position: 0 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("decision skills in the read schemas (0.8.0)", () => {
  it("SKILL_KINDS mirrors the SDK kinds", () => {
    expect([...SKILL_KINDS]).toEqual(["chat", "decision"]);
  });

  it("skillDetailSchema keeps skillKind + decisionSpec on parse (not stripped)", () => {
    const parsed = skillDetailSchema.parse(sdkDecisionSkill);
    expect(parsed.skillKind).toBe("decision");
    expect(parsed.decisionSpec).toEqual(decisionSpec);
  });

  it("skillDetailSchema accepts a chat skill with decisionSpec: null, and one without either field (older server)", () => {
    expect(skillDetailSchema.safeParse({ ...sdkSkillWithFiles, skillKind: "chat", decisionSpec: null }).success).toBe(true);
    const parsed = skillDetailSchema.parse(sdkSkillWithFiles);
    expect(parsed.skillKind).toBeUndefined();
    expect("decisionSpec" in parsed).toBe(false);
  });

  it("skillDetailSchema rejects an unknown kind and a non-object spec", () => {
    expect(skillDetailSchema.safeParse({ ...sdkSkillWithFiles, skillKind: "agent" }).success).toBe(false);
    expect(skillDetailSchema.safeParse({ ...sdkSkillWithFiles, decisionSpec: "yes" }).success).toBe(false);
    expect(skillDetailSchema.safeParse({ ...sdkSkillWithFiles, decisionSpec: [] }).success).toBe(false);
  });

  it("toSkillSummary carries skillKind for the list badge, and omits it when the server did not send it", () => {
    const summary = toSkillSummary(sdkDecisionSkill);
    expect(summary.skillKind).toBe("decision");
    expect(skillSummarySchema.parse(summary)).toEqual(summary);
    // The summary never ships the spec (lean list rows).
    expect("decisionSpec" in summary).toBe(false);
    expect("skillKind" in toSkillSummary(sdkSkill)).toBe(false);
  });

  it("isDecisionSkill treats an absent kind as chat", () => {
    expect(isDecisionSkill(sdkDecisionSkill)).toBe(true);
    expect(isDecisionSkill(sdkSkill)).toBe(false);
    expect(isDecisionSkill({ skillKind: "chat" })).toBe(false);
  });

  it("the update/create request schemas stay strict and do NOT accept skillKind / decisionSpec", () => {
    expect(skillStructuralUpdateRequestSchema.safeParse({ skillKind: "decision" }).success).toBe(false);
    expect(skillStructuralUpdateRequestSchema.safeParse({ decisionSpec }).success).toBe(false);
    expect(skillUpdateRequestSchema.safeParse({ decisionSpec }).success).toBe(false);
    expect(
      skillCreateRequestSchema.safeParse({ name: "x", systemPrompt: "y", skillKind: "decision" }).success,
    ).toBe(false);
  });
});

describe("llmIntegrationSchema — nullable defaultModel (0.8.0)", () => {
  const row: LlmIntegration = {
    id: "tllm_1",
    displayName: "Primary",
    provider: "openai",
    defaultModel: null,
    isDefault: true,
    apiKeyMask: "***",
  };

  it("accepts defaultModel: null (SDK 0.32.0 widening)", () => {
    expect(llmIntegrationSchema.safeParse(row).success).toBe(true);
    expect(listLlmIntegrationsResponseSchema.safeParse({ data: [row] }).success).toBe(true);
  });

  it("still accepts a string defaultModel and still requires the key", () => {
    expect(llmIntegrationSchema.safeParse({ ...row, defaultModel: "gpt-5.4" }).success).toBe(true);
    const { defaultModel: _d, ...missing } = row;
    expect(llmIntegrationSchema.safeParse(missing).success).toBe(false);
  });
});

describe("skillRoleModelsMapSchema — the GET role-models shape (fail closed)", () => {
  const entry = {
    skillId: "sk_1",
    role: "preflight_guard",
    position: 0,
    llmIntegrationId: "tllm_dec",
    model: "jev-1.14.0",
    llmSource: "pinned",
    mode: "decision",
  };
  const map = { main: [], preflight_guard: [entry], postflight_guard: [], eval_judge: [] };

  it("accepts the bare role map and keeps server fields (skillId/role/position) on parse", () => {
    const r = skillRoleModelsMapSchema.safeParse(map);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.preflight_guard[0]).toEqual(entry);
  });

  it("rejects the { skillId, roles } wrapper an older @baobox/sdk returned", () => {
    expect(skillRoleModelsMapSchema.safeParse({ skillId: "sk_1", roles: map }).success).toBe(false);
  });

  it("rejects a missing role, a non-array chain, an unknown mode or llmSource, and a missing entry field", () => {
    const { eval_judge: _e, ...missing } = map;
    expect(skillRoleModelsMapSchema.safeParse(missing).success).toBe(false);
    expect(skillRoleModelsMapSchema.safeParse({ ...map, main: null }).success).toBe(false);
    expect(skillRoleModelsMapSchema.safeParse({ ...map, preflight_guard: [{ ...entry, mode: "judge" }] }).success).toBe(false);
    expect(skillRoleModelsMapSchema.safeParse({ ...map, preflight_guard: [{ ...entry, llmSource: "byok" }] }).success).toBe(false);
    const { model: _m, ...noModel } = entry;
    expect(skillRoleModelsMapSchema.safeParse({ ...map, preflight_guard: [noModel] }).success).toBe(false);
  });

  it("accepts an entry without mode (older server) — the panel then treats it as chat", () => {
    const { mode: _mode, ...noMode } = entry;
    expect(skillRoleModelsMapSchema.safeParse({ ...map, preflight_guard: [noMode] }).success).toBe(true);
  });
});

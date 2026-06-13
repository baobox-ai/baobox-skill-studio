import type { Skill, SkillWithFiles } from "@baobox/sdk";
import { describe, expect, it } from "vitest";
import {
  REASONING_EFFORT_VALUES,
  attachSubSkillRequestSchema,
  attachToolRequestSchema,
  contractErrorSchema,
  listSkillsResponseSchema,
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
  it("accepts all four tiers", () => {
    expect(REASONING_EFFORT_VALUES).toEqual(["minimal", "low", "medium", "high"]);
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

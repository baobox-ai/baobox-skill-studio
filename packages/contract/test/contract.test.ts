import type { Skill, SkillWithFiles } from "@baobox/sdk";
import { describe, expect, it } from "vitest";
import {
  listSkillsResponseSchema,
  skillDetailResponseSchema,
  skillDetailSchema,
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
});

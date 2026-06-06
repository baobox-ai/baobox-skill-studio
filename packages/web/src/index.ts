// @baobox/skill-builder — the framework-agnostic <baobox-skill-builder> Web
// Component for the BaoBox Skill Studio (Phase 1: list + detail + edit one
// field). Reads everything from a configurable `api-base` (the tenant BFF) via
// `@baobox/skill-builder-contract`; never imports `@baobox/sdk`.
//
// npm consumers call `registerSkillBuilder()` once, then use the element. The
// prebuilt standalone bundle (`@baobox/skill-builder/standalone`) auto-registers.
export {
  BaoBoxSkillBuilderElement,
  DEFAULT_TAG,
  registerSkillBuilder,
} from "./element.js";
export { SkillStudio, type SkillStudioProps } from "./SkillStudio.js";
export {
  createApi,
  SkillStudioApiError,
  type SkillStudioApi,
  type SkillDetail,
  type SkillSummary,
  type SkillUpdateRequest,
} from "./api.js";

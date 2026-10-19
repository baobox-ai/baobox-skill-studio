import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import type { IntegrationModelsViewResponse, SkillDetail, SkillRoleModelsMap, SkillStudioApi } from "../src/api.js";
import { registerSkillBuilder } from "../src/element.js";
import { SkillStudio } from "../src/SkillStudio.js";
import { MODEL_CATALOG, getReasoningEfforts } from "../src/modelCatalog.js";

const detail: SkillDetail = {
  id: "sk_1",
  name: "Invoice Chaser",
  description: "Chases invoices.",
  systemPrompt: "You are a chaser.",
  model: "MiniMax-M2.7",
  temperature: 0.7,
  maxTokens: 4096,
  sourceUrl: null,
  tenantId: "t_1",
  createdAt: "x",
  updatedAt: "x",
  files: [],
};

// A complete SkillStudioApi stub — every method present, overridable per test.
// `listAvailableTools` defaults to rejecting so the tool panel falls back to
// the free-text attach-by-id input (preserving existing test expectations).
// Pass `listAvailableTools: vi.fn(async () => [...])` to test the picker path.
function mockApi(over: Partial<SkillStudioApi> = {}): SkillStudioApi {
  return {
    listSkills: vi.fn(async () => [
      { id: "sk_1", name: "Invoice Chaser", description: "Chases invoices.", model: "MiniMax-M2.7", tenantId: "t_1", updatedAt: "x" },
      { id: "sk_2", name: "Support Triage", description: "Routes.", model: "MiniMax-M2.7", tenantId: null, updatedAt: "x" },
    ]),
    getSkill: vi.fn(async () => detail),
    updateSkill: vi.fn(async (_id, body) => ({ ...detail, ...body })),
    createSkill: vi.fn(async (body) => ({ ...detail, id: "sk_new", ...body })),
    updateSkillStructural: vi.fn(async (_id, body) => ({ ...detail, ...body })),
    listAttachedSkills: vi.fn(async () => []),
    attachSubSkill: vi.fn(async () => {}),
    detachSubSkill: vi.fn(async () => {}),
    listTools: vi.fn(async () => []),
    attachTool: vi.fn(async () => {}),
    detachTool: vi.fn(async () => {}),
    getParameters: vi.fn(async () => []),
    setParameters: vi.fn(async (_id, params) => params),
    listAvailableTools: vi.fn(async () => { throw new Error("not supported"); }),
    // #320 — default to rejecting so the picker falls back to the static catalog.
    listModels: vi.fn(async () => { throw new Error("not supported"); }),
    // #328 — per-role guard model config. Default to empty chains so the panel renders.
    getRoleModels: vi.fn(async () => ({
      main: [],
      preflight_guard: [],
      postflight_guard: [],
      eval_judge: [],
    })),
    putRoleModels: vi.fn(async () => ({})),
    // #330 — integration-first model picker. Default to empty list so the picker
    // falls back to the free-text catalog model input (preserves existing model
    // picker test expectations — tests that exercise integrations supply their own).
    listLlmIntegrations: vi.fn(async () => []),
    listIntegrationModels: vi.fn(async () => ({
      integrationId: "",
      provider: "",
      models: [],
      providerListError: null,
    })),
    // ED-2 (#433) — incoming skill drafts. Default to empty list.
    listDrafts: vi.fn(async () => []),
    approveDraft: vi.fn(async () => ({
      versionId: "",
      skillId: "",
      reviewState: "approved",
      versionStatus: "active",
      skillStatus: "active",
    })),
    ...over,
  };
}

describe("<SkillStudio> — list", () => {
  it("renders the skill list and a New-skill action", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi()} />);
    expect(await screen.findByText("Invoice Chaser")).toBeTruthy();
    expect(screen.getByText("Support Triage")).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ New skill" })).toBeTruthy();
  });

  it("shows a config error and does NOT fetch when api-base is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<SkillStudio apiBase="" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/api-base/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("surfaces a list error with a retry", async () => {
    const api = mockApi({
      listSkills: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([]),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledTimes(2));
  });
});

describe("<SkillStudio> — structural edit", () => {
  it("opens a tenant skill and shows the editable structural form", async () => {
    const api = mockApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    const desc = (await screen.findByLabelText("Description")) as HTMLTextAreaElement;
    expect(desc.value).toBe("Chases invoices.");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Invoice Chaser");
    expect((screen.getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe("You are a chaser.");
    expect(api.getSkill).toHaveBeenCalledWith("sk_1");
  });

  it("saves only the changed fields via updateSkillStructural", async () => {
    const api = mockApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    const desc = (await screen.findByLabelText("Description")) as HTMLTextAreaElement;
    fireEvent.input(desc, { target: { value: "New copy" } });
    const saveBtn = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    await waitFor(() => expect(saveBtn.disabled).toBe(false));
    fireEvent.click(saveBtn);

    await waitFor(() => expect(api.updateSkillStructural).toHaveBeenCalledWith("sk_1", { description: "New copy" }));
    expect(await screen.findByText("Saved ✓")).toBeTruthy();
  });
});

describe("<SkillStudio> — create wizard", () => {
  it("creates a skill and navigates to its detail", async () => {
    const api = mockApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ New skill" }));

    fireEvent.input(await screen.findByLabelText("Name"), { target: { value: "Greeter" } });
    fireEvent.input(screen.getByLabelText("System prompt"), { target: { value: "Say hi." } });
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() =>
      expect(api.createSkill).toHaveBeenCalledWith(expect.objectContaining({ name: "Greeter", systemPrompt: "Say hi." })),
    );
    // navigates to the new skill's detail
    await waitFor(() => expect(api.getSkill).toHaveBeenCalledWith("sk_new"));
  });

  it("disables Create until name + system prompt are present", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi()} />);
    fireEvent.click(await screen.findByRole("button", { name: "+ New skill" }));
    const createBtn = (await screen.findByRole("button", { name: "Create skill" })) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "X" } });
    expect(createBtn.disabled).toBe(true); // still need the prompt
    fireEvent.input(screen.getByLabelText("System prompt"), { target: { value: "p" } });
    expect(createBtn.disabled).toBe(false);
  });
});

describe("<SkillStudio> — system skill is read-only + cloneable (BaoBox#264 Defect B)", () => {
  const systemDetail: SkillDetail = { ...detail, id: "sk_sys", name: "Guard", tenantId: null, isSystem: 1, cloneable: true };

  it("renders a system skill read-only with no editable form, and offers Copy as my own", async () => {
    const api = mockApi({ getSkill: vi.fn(async () => systemDetail) });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    expect(await screen.findByText(/System skill — read-only/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy as my own" })).toBeTruthy();
    // No editable structural form for a read-only system skill.
    expect(screen.queryByLabelText("System prompt")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("Copy as my own creates a tenant-owned copy and opens it", async () => {
    const api = mockApi({
      getSkill: vi.fn(async (id: string) => (id === "sk_copy" ? { ...detail, id: "sk_copy" } : systemDetail)),
      createSkill: vi.fn(async () => ({ ...detail, id: "sk_copy" })),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));
    fireEvent.click(await screen.findByRole("button", { name: "Copy as my own" }));

    await waitFor(() =>
      expect(api.createSkill).toHaveBeenCalledWith(expect.objectContaining({ name: "Guard (copy)", systemPrompt: "You are a chaser." })),
    );
    await waitFor(() => expect(api.getSkill).toHaveBeenCalledWith("sk_copy"));
  });

  it("hides Copy as my own when the system skill is not cloneable", async () => {
    const api = mockApi({ getSkill: vi.fn(async () => ({ ...systemDetail, cloneable: false })) });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));
    expect(await screen.findByText(/can't be edited by your tenant/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy as my own" })).toBeNull();
  });
});

describe("<SkillStudio> — orchestrator panels", () => {
  it("surfaces a cycle rejection when attaching a sub-skill would loop", async () => {
    const { SkillStudioApiError } = await import("../src/api.js");
    const api = mockApi({
      attachSubSkill: vi.fn(async () => {
        throw new SkillStudioApiError(422, "cycle_detected", "would create a cycle");
      }),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    const select = (await screen.findByLabelText("Attach a sub-skill")) as HTMLSelectElement;
    // Wait for the candidate option to load (sk_2; sk_1 is self) before selecting.
    await screen.findByText("Support Triage (sk_2)");
    fireEvent.change(select, { target: { value: "sk_2" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    expect(await screen.findByText(/would create a cycle in the orchestrator graph/)).toBeTruthy();
  });

  it("surfaces an allowlist rejection when attaching an off-list tool", async () => {
    const { SkillStudioApiError } = await import("../src/api.js");
    const api = mockApi({
      attachTool: vi.fn(async () => {
        throw new SkillStudioApiError(403, "tool_not_allowed", "nope");
      }),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    fireEvent.input(await screen.findByLabelText("Tool id to attach"), { target: { value: "tl_x" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach tool" }));

    expect(await screen.findByText(/isn't on your allowlist/)).toBeTruthy();
  });

  it("loads parameters (secret masked) and saves the EXACT set — an untouched secret keeps (blank, no local fields)", async () => {
    const api = mockApi({
      getParameters: vi.fn(async () => [
        { key: "account_id", value: "acct_1" },
        { key: "api_token", value: "", secret: true },
      ]),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    const valueInputs = (await screen.findAllByLabelText("Parameter value")) as HTMLInputElement[];
    expect(valueInputs[0]?.value).toBe("acct_1");
    expect(valueInputs[1]?.value).toBe(""); // secret arrived masked
    fireEvent.click(screen.getByRole("button", { name: "Save parameters" }));
    // Untouched secret goes up as {secret:true, value:""} (the "keep" signal); no
    // _id / _loadedSecret leaks into the contract payload.
    await waitFor(() =>
      expect(api.setParameters).toHaveBeenCalledWith("sk_1", [
        { key: "account_id", value: "acct_1" },
        { key: "api_token", value: "", secret: true },
      ]),
    );
  });

  it("typing a new secret value replaces it (sent verbatim, not kept)", async () => {
    const api = mockApi({
      getParameters: vi.fn(async () => [{ key: "api_token", value: "", secret: true }]),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));
    const valueInput = (await screen.findByLabelText("Parameter value")) as HTMLInputElement;
    fireEvent.input(valueInput, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save parameters" }));
    await waitFor(() =>
      expect(api.setParameters).toHaveBeenCalledWith("sk_1", [{ key: "api_token", value: "new-secret", secret: true }]),
    );
  });

  it("blocks save and shows an error when temperature is out of range", async () => {
    const api = mockApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));
    const temp = (await screen.findByLabelText("Temperature")) as HTMLInputElement;
    fireEvent.input(temp, { target: { value: "5" } });
    expect(await screen.findByText(/Temperature must be a number between 0 and 2/)).toBeTruthy();
    const saveBtn = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    fireEvent.click(saveBtn);
    expect(api.updateSkillStructural).not.toHaveBeenCalled();
  });
});

describe("registerSkillBuilder", () => {
  it("defines the custom element idempotently", () => {
    expect(registerSkillBuilder()).toBe("baobox-skill-builder");
    expect(customElements.get("baobox-skill-builder")).toBeTruthy();
    expect(() => registerSkillBuilder()).not.toThrow();
  });
});

describe("model catalog", () => {
  it("covers at least three providers", () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(3);
  });

  it("includes MiniMax-M2.7 as a sampling model", () => {
    const minimax = MODEL_CATALOG.find((p) => p.id === "minimax");
    expect(minimax).toBeTruthy();
    const m27 = minimax?.models.find((m) => m.id === "MiniMax-M2.7");
    expect(m27?.family).toBe("sampling");
  });

  it("marks gpt-5 / gpt-5-mini / gpt-5-nano as reasoning models", () => {
    const openai = MODEL_CATALOG.find((p) => p.id === "openai");
    expect(openai).toBeTruthy();
    for (const id of ["gpt-5", "gpt-5-mini", "gpt-5-nano"]) {
      const m = openai?.models.find((m) => m.id === id);
      expect(m?.family, `${id} should be reasoning`).toBe("reasoning");
    }
  });

  it("marks gpt-5.4 and gpt-5.5 as reasoning models", () => {
    const openai = MODEL_CATALOG.find((p) => p.id === "openai");
    expect(openai).toBeTruthy();
    for (const id of ["gpt-5.4", "gpt-5.5"]) {
      const m = openai?.models.find((m) => m.id === id);
      expect(m?.family, `${id} should be reasoning`).toBe("reasoning");
    }
  });
});

describe("getReasoningEfforts — per-model effort sets", () => {
  it("gpt-5 offers minimal but NOT xhigh or none", () => {
    const efforts = getReasoningEfforts("gpt-5");
    expect(efforts).toContain("minimal");
    expect(efforts).not.toContain("xhigh");
    expect(efforts).not.toContain("none");
  });

  it("gpt-5-mini and gpt-5-nano share the same restricted set as gpt-5", () => {
    for (const id of ["gpt-5-mini", "gpt-5-nano"]) {
      const efforts = getReasoningEfforts(id);
      expect(efforts, `${id} should include minimal`).toContain("minimal");
      expect(efforts, `${id} should not include xhigh`).not.toContain("xhigh");
      expect(efforts, `${id} should not include none`).not.toContain("none");
    }
  });

  it("gpt-5.5 offers xhigh and none but NOT minimal", () => {
    const efforts = getReasoningEfforts("gpt-5.5");
    expect(efforts).toContain("xhigh");
    expect(efforts).toContain("none");
    expect(efforts).not.toContain("minimal");
  });

  it("gpt-5.4 offers xhigh and none but NOT minimal", () => {
    const efforts = getReasoningEfforts("gpt-5.4");
    expect(efforts).toContain("xhigh");
    expect(efforts).toContain("none");
    expect(efforts).not.toContain("minimal");
  });

  it("sampling model (MiniMax-M2.7) returns undefined", () => {
    expect(getReasoningEfforts("MiniMax-M2.7")).toBeUndefined();
  });

  it("unknown free-text model returns the full 6-value set", () => {
    const efforts = getReasoningEfforts("my-custom-model-xyz");
    expect(efforts).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
  });
});

describe("<SkillStudio> model picker", () => {
  it("renders a model input in the detail view", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi()} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));
    // The model input is labelled "Model" and pre-filled with the skill's model
    const modelInput = (await screen.findByLabelText("Model")) as HTMLInputElement;
    expect(modelInput.value).toBe("MiniMax-M2.7");
  });

  it("shows temperature and maxTokens for a sampling model (MiniMax-M2.7)", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi()} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));
    // MiniMax-M2.7 is a sampling model → temperature + maxTokens visible
    expect(await screen.findByLabelText("Temperature")).toBeTruthy();
    expect(screen.getByLabelText("Max Tokens")).toBeTruthy();
    // reasoningEffort selector must NOT be in the DOM
    expect(screen.queryByLabelText("Reasoning Effort")).toBeNull();
  });

  it("shows reasoningEffort and hides temperature/maxTokens for a reasoning model (gpt-5)", async () => {
    const reasoningDetail = {
      ...detail,
      model: "gpt-5",
      reasoningEffort: "medium" as const,
    };
    const api = mockApi({
      getSkill: vi.fn(async () => reasoningDetail),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    // wait for detail to load
    await screen.findByLabelText("Model");

    // switch to gpt-5 via the model input
    const modelInput = screen.getByLabelText("Model") as HTMLInputElement;
    fireEvent.input(modelInput, { target: { value: "gpt-5" } });

    // reasoning effort selector should appear
    expect(await screen.findByLabelText("Reasoning Effort")).toBeTruthy();
    // temperature + maxTokens must be hidden
    expect(screen.queryByLabelText("Temperature")).toBeNull();
    expect(screen.queryByLabelText("Max Tokens")).toBeNull();
  });

  it("accepts a free-text model (not in catalog) and defaults to sampling params", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi()} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    const modelInput = (await screen.findByLabelText("Model")) as HTMLInputElement;
    fireEvent.input(modelInput, { target: { value: "my-custom-model-xyz" } });

    // free-text → family unknown → sampling panel shown
    expect(screen.getByLabelText("Temperature")).toBeTruthy();
    expect(screen.getByLabelText("Max Tokens")).toBeTruthy();
    expect(screen.queryByLabelText("Reasoning Effort")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration-first model picker (#330)
// ---------------------------------------------------------------------------
describe("<SkillStudio> integration-first model picker (#330)", () => {
  const INTEGRATION = {
    id: "int_openai",
    displayName: "OpenAI (tenant)",
    provider: "openai",
    defaultModel: "openai/gpt-4o",
    isDefault: true,
    apiKeyMask: "sk-...abc",
  };

  const MODELS_VIEW: IntegrationModelsViewResponse = {
    integrationId: "int_openai",
    provider: "openai",
    models: [
      { id: "openai/gpt-4o", displayName: "GPT-4o", source: "provider", paramProfile: "sampling", reasoningEfforts: [], pricing: null },
      { id: "openai/gpt-5", displayName: "GPT-5", source: "provider", paramProfile: "reasoning", reasoningEfforts: ["minimal", "low", "medium", "high"], pricing: null },
    ],
    providerListError: null,
  };

  it("shows the LLM integration selector when the tenant has integrations", async () => {
    const api = mockApi({
      listLlmIntegrations: vi.fn(async () => [INTEGRATION]),
      listIntegrationModels: vi.fn(async () => MODELS_VIEW),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    // Integration dropdown should appear and eventually be enabled (loaded)
    const integrationSelect = (await screen.findByLabelText("LLM integration")) as HTMLSelectElement;
    await waitFor(() => expect(integrationSelect.disabled).toBe(false));
    expect(integrationSelect).toBeTruthy();
    // Free-text model input must NOT be visible (picker takes over)
    // (model select only appears after choosing an integration)
    expect(screen.queryByRole("note", { name: /No LLM integrations/i })).toBeNull();
  });

  it("picks an integration → shows model dropdown → selecting model marks save dirty", async () => {
    const listIntegrationModels = vi.fn(async () => MODELS_VIEW);
    const api = mockApi({
      listLlmIntegrations: vi.fn(async () => [INTEGRATION]),
      listIntegrationModels,
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    // Wait for integration select to load (not disabled)
    const integrationSelect = (await screen.findByLabelText("LLM integration")) as HTMLSelectElement;
    await waitFor(() => expect(integrationSelect.disabled).toBe(false));

    // Select the integration
    fireEvent.change(integrationSelect, { target: { value: "int_openai" } });

    // Model dropdown should appear after integration is selected
    const modelSelect = (await screen.findByLabelText("Model")) as HTMLSelectElement;
    expect(modelSelect.tagName).toBe("SELECT");

    // Select a model
    fireEvent.change(modelSelect, { target: { value: "openai/gpt-4o" } });

    // Save button should be enabled (dirty)
    await waitFor(() => {
      const saveBtn = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;
      expect(saveBtn.disabled).toBe(false);
    });
  });

  it("save sends llmIntegrationId + model + llmSource='pinned' to updateSkillStructural", async () => {
    const updateSkillStructural = vi.fn(async (_id: string, body: unknown) => ({ ...detail, ...(body as object) }));
    const api = mockApi({
      listLlmIntegrations: vi.fn(async () => [INTEGRATION]),
      listIntegrationModels: vi.fn(async () => MODELS_VIEW),
      updateSkillStructural,
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    // Select the integration — wait for it to be enabled first
    const integrationSelect = (await screen.findByLabelText("LLM integration")) as HTMLSelectElement;
    await waitFor(() => expect(integrationSelect.disabled).toBe(false));
    fireEvent.change(integrationSelect, { target: { value: "int_openai" } });

    // Wait for and select a model
    const modelSelect = (await screen.findByLabelText("Model")) as HTMLSelectElement;
    await waitFor(() => expect(modelSelect.disabled).toBe(false));
    fireEvent.change(modelSelect, { target: { value: "openai/gpt-4o" } });

    // Wait for Save to become enabled then click
    const saveBtn = await screen.findByRole("button", { name: "Save changes" });
    await waitFor(() => expect((saveBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveBtn);

    await waitFor(() => expect(updateSkillStructural).toHaveBeenCalledTimes(1));
    const [, payload] = updateSkillStructural.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.llmIntegrationId).toBe("int_openai");
    expect(payload.llmSource).toBe("pinned");
  });

  it("clearing integration (back to sentinel) sends llmIntegrationId=null + llmSource='tenant_default'", async () => {
    // Skill already has an integration set on the server
    const detailWithIntegration = {
      ...detail,
      llmIntegrationId: "int_openai",
    };
    const updateSkillStructural = vi.fn(async (_id: string, body: unknown) => ({ ...detailWithIntegration, ...(body as object) }));
    const api = mockApi({
      getSkill: vi.fn(async () => detailWithIntegration as unknown as typeof detail),
      listLlmIntegrations: vi.fn(async () => [INTEGRATION]),
      listIntegrationModels: vi.fn(async () => MODELS_VIEW),
      updateSkillStructural,
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    // Integration select should be pre-selected to "int_openai"
    const integrationSelect = (await screen.findByLabelText("LLM integration")) as HTMLSelectElement;
    await waitFor(() => expect(integrationSelect.disabled).toBe(false));

    // Clear back to sentinel ("")
    fireEvent.change(integrationSelect, { target: { value: "" } });

    // Save — wait for dirty then click
    const saveBtn = await screen.findByRole("button", { name: "Save changes" });
    await waitFor(() => expect((saveBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveBtn);

    await waitFor(() => expect(updateSkillStructural).toHaveBeenCalledTimes(1));
    const [, payload] = updateSkillStructural.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.llmIntegrationId).toBeNull();
    expect(payload.llmSource).toBe("tenant_default");
  });

  it("shows a providerListError soft note when the provider list call fails", async () => {
    const brokenView = { ...MODELS_VIEW, models: [], providerListError: "provider API unreachable" };
    const api = mockApi({
      listLlmIntegrations: vi.fn(async () => [INTEGRATION]),
      listIntegrationModels: vi.fn(async () => brokenView),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    const integrationSelect = (await screen.findByLabelText("LLM integration")) as HTMLSelectElement;
    await waitFor(() => expect(integrationSelect.disabled).toBe(false));
    fireEvent.change(integrationSelect, { target: { value: "int_openai" } });

    // Error note should appear in the model picker area
    await screen.findByText(/provider API unreachable/i);
  });

  it("falls back to free-text catalog model input when no integrations are configured", async () => {
    // Default mockApi already returns [] for listLlmIntegrations
    render(<SkillStudio apiBase="/bff" api={mockApi()} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    // Free-text model input should appear (fallback)
    const modelInput = (await screen.findByLabelText("Model")) as HTMLInputElement;
    expect(modelInput.tagName).toBe("INPUT");
    // Note about no integrations should be visible
    await screen.findByText(/No LLM integrations configured/i);
  });
});

// ---------------------------------------------------------------------------
// baobox#846 — guard-slot write body, read-only Portal pins, decision skills.
// ---------------------------------------------------------------------------

const EMPTY_ROLES: SkillRoleModelsMap = { main: [], preflight_guard: [], postflight_guard: [], eval_judge: [] };

function roleEntry(over: Partial<SkillRoleModelsMap["main"][number]> & { role: SkillRoleModelsMap["main"][number]["role"] }) {
  return {
    skillId: "sk_1",
    position: 0,
    llmIntegrationId: null,
    model: "gpt-5",
    llmSource: "tenant_default" as const,
    mode: "chat" as const,
    ...over,
  };
}

async function openFirstSkill(api: SkillStudioApi) {
  render(<SkillStudio apiBase="/bff" api={api} />);
  fireEvent.click(await screen.findByText("Invoice Chaser"));
}

describe("<SkillStudio> per-role models — guard-slot write body (baobox#846)", () => {
  it("a guard Save sends tenant_default + model + mode chat (never pinned with a null integration)", async () => {
    const api = mockApi();
    await openFirstSkill(api);
    const row = await screen.findByTestId("role-row-preflight_guard");
    const [primary, backup] = within(row).getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(primary as HTMLSelectElement, { target: { value: "gpt-5" } });
    fireEvent.change(backup as HTMLSelectElement, { target: { value: "MiniMax-M2.7" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.putRoleModels).toHaveBeenCalledTimes(1));
    expect(api.putRoleModels).toHaveBeenCalledWith("sk_1", {
      role: "preflight_guard",
      chain: [
        { llmIntegrationId: null, model: "gpt-5", llmSource: "tenant_default", mode: "chat" },
        { llmIntegrationId: null, model: "MiniMax-M2.7", llmSource: "tenant_default", mode: "chat" },
      ],
    });
    const body = (api.putRoleModels as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as { chain: Array<{ llmSource: string }> };
    expect(body.chain.some((e) => e.llmSource === "pinned")).toBe(false);
  });

  it("the main backup Save uses the same tenant_default body", async () => {
    const api = mockApi();
    await openFirstSkill(api);
    const row = await screen.findByTestId("role-row-main");
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "gpt-5-mini" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.putRoleModels).toHaveBeenCalledWith("sk_1", {
        role: "main",
        chain: [{ llmIntegrationId: null, model: "gpt-5-mini", llmSource: "tenant_default", mode: "chat" }],
      }),
    );
  });

  it("each guard row explains the tenant-default + same-provider rule", async () => {
    await openFirstSkill(mockApi());
    const row = await screen.findByTestId("role-row-postflight_guard");
    expect(within(row).getByText(/tenant's default LLM integration/)).toBeTruthy();
    expect(within(row).getByText(/different provider/)).toBeTruthy();
  });

  it("a tenant_default chain Studio wrote stays editable and round-trips", async () => {
    const api = mockApi({
      getRoleModels: vi.fn(async () => ({
        ...EMPTY_ROLES,
        preflight_guard: [roleEntry({ role: "preflight_guard", model: "gpt-5" })],
      })),
    });
    await openFirstSkill(api);
    const row = await screen.findByTestId("role-row-preflight_guard");
    await waitFor(() => expect((within(row).getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("gpt-5"));
    const save = within(row).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.putRoleModels).toHaveBeenCalledWith("sk_1", {
        role: "preflight_guard",
        chain: [{ llmIntegrationId: null, model: "gpt-5", llmSource: "tenant_default", mode: "chat" }],
      }),
    );
  });
});

describe("<SkillStudio> per-role models — Portal pins are read-only (baobox#846)", () => {
  it("a role whose chain has a mode: decision entry renders read-only with Save + Inherit disabled", async () => {
    const api = mockApi({
      getRoleModels: vi.fn(async () => ({
        ...EMPTY_ROLES,
        preflight_guard: [
          roleEntry({ role: "preflight_guard", llmIntegrationId: "tllm_dec", model: "jev-1.14.0", llmSource: "pinned", mode: "decision" }),
          roleEntry({ role: "preflight_guard", position: 1, model: "gpt-5" }),
        ],
      })),
    });
    await openFirstSkill(api);
    const row = await screen.findByTestId("role-row-preflight_guard");
    await waitFor(() => expect(within(row).getByText("set in the Portal (decision model)", { exact: false })).toBeTruthy());
    // Status shows the decision entry as such.
    expect(within(row).getByText("jev-1.14.0 · decision → gpt-5")).toBeTruthy();
    const save = within(row).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    const inherit = within(row).getByRole("button", { name: "Inherit default" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(inherit.disabled).toBe(true);
    for (const sel of within(row).getAllByRole("combobox") as HTMLSelectElement[]) expect(sel.disabled).toBe(true);
    fireEvent.click(save);
    fireEvent.click(inherit);
    expect(api.putRoleModels).not.toHaveBeenCalled();
    // Other roles stay editable.
    const post = screen.getByTestId("role-row-postflight_guard");
    expect((within(post).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a chat chain pinned to an integration is also read-only (Studio would otherwise replace it)", async () => {
    const api = mockApi({
      getRoleModels: vi.fn(async () => ({
        ...EMPTY_ROLES,
        postflight_guard: [roleEntry({ role: "postflight_guard", llmIntegrationId: "tllm_1", model: "gpt-5", llmSource: "pinned" })],
      })),
    });
    await openFirstSkill(api);
    const row = await screen.findByTestId("role-row-postflight_guard");
    await waitFor(() => expect(within(row).getByTestId("postflight_guard-readonly")).toBeTruthy());
    expect((within(row).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

const decisionDetail: SkillDetail = {
  ...detail,
  id: "sk_dec",
  name: "Inbox Triage",
  systemPrompt: "Triage inbound support email.",
  model: "jev-1.14.0",
  skillKind: "decision",
  decisionSpec: {
    version: 1,
    questions: [
      { id: "urgent", type: "boolean", prompt: "Is the message urgent?" },
      { id: "severity", type: "score", prompt: "How severe?", levels: [{ label: "low", description: "minor" }, { label: "high", description: "major" }] },
    ],
  },
};

function decisionApi(over: Partial<SkillStudioApi> = {}): SkillStudioApi {
  return mockApi({
    listSkills: vi.fn(async () => [
      { id: "sk_dec", name: "Inbox Triage", description: "Triage.", model: "jev-1.14.0", tenantId: "t_1", updatedAt: "x", skillKind: "decision" as const },
      { id: "sk_1", name: "Invoice Chaser", description: "Chases invoices.", model: "MiniMax-M2.7", tenantId: "t_1", updatedAt: "x", skillKind: "chat" as const },
    ]),
    getSkill: vi.fn(async (id: string) => (id === "sk_dec" ? decisionDetail : detail)),
    updateSkillStructural: vi.fn(async (_id, body) => ({ ...decisionDetail, ...body })),
    ...over,
  });
}

describe("<SkillStudio> decision skills (baobox#846)", () => {
  it("the list shows a decision badge on decision skills only", async () => {
    render(<SkillStudio apiBase="/bff" api={decisionApi()} />);
    const dec = (await screen.findByText("Inbox Triage")).closest("button") as HTMLElement;
    expect(within(dec).getByTestId("skill-kind-badge").textContent).toBe("decision");
    const chat = screen.getByText("Invoice Chaser").closest("button") as HTMLElement;
    expect(within(chat).queryByTestId("skill-kind-badge")).toBeNull();
  });

  it("the detail shows the badge, an editable Preamble, and the spec as read-only JSON", async () => {
    const api = decisionApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Inbox Triage"));
    const preamble = (await screen.findByLabelText("Preamble")) as HTMLTextAreaElement;
    expect(preamble.value).toBe("Triage inbound support email.");
    expect(screen.queryByLabelText("System prompt")).toBeNull();
    expect(screen.getByTestId("skill-kind-badge")).toBeTruthy();
    expect(screen.getByTestId("preamble-counter").textContent).toBe(`${"Triage inbound support email.".length} / 4000`);
    const spec = screen.getByLabelText("Decision spec");
    expect(JSON.parse(spec.textContent ?? "")).toEqual(decisionDetail.decisionSpec);
    expect(screen.getByText(/Edit the questions, the decision model and its integration in the BaoBox/)).toBeTruthy();
  });

  it("hides every panel BaoBox would refuse on a decision skill", async () => {
    const api = decisionApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Inbox Triage"));
    await screen.findByLabelText("Preamble");
    // Model / integration / params
    expect(screen.queryByLabelText("Model")).toBeNull();
    expect(screen.queryByLabelText("LLM integration")).toBeNull();
    expect(screen.queryByLabelText("Temperature")).toBeNull();
    expect(screen.queryByLabelText("Max Tokens")).toBeNull();
    expect(screen.queryByLabelText("Reasoning Effort")).toBeNull();
    expect(api.listLlmIntegrations).not.toHaveBeenCalled();
    // Tools / sub-skills
    expect(screen.queryByText("Sub-skills (orchestrator graph)")).toBeNull();
    expect(screen.queryByText("Tools")).toBeNull();
    expect(api.listTools).not.toHaveBeenCalled();
    expect(api.listAttachedSkills).not.toHaveBeenCalled();
    // Per-role: preflight only — no main backup, no postflight.
    expect(await screen.findByTestId("role-row-preflight_guard")).toBeTruthy();
    expect(screen.queryByTestId("role-row-postflight_guard")).toBeNull();
    expect(screen.queryByTestId("role-row-main")).toBeNull();
  });

  it("a preamble edit saves only systemPrompt (no model / params / integration keys)", async () => {
    const api = decisionApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Inbox Triage"));
    const preamble = await screen.findByLabelText("Preamble");
    fireEvent.input(preamble, { target: { value: "Triage inbound email. Be strict." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(api.updateSkillStructural).toHaveBeenCalledWith("sk_dec", { systemPrompt: "Triage inbound email. Be strict." }),
    );
  });

  it("blocks save when the preamble exceeds 4000 characters", async () => {
    const api = decisionApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Inbox Triage"));
    const preamble = await screen.findByLabelText("Preamble");
    fireEvent.input(preamble, { target: { value: "x".repeat(4001) } });
    expect(await screen.findByText("The preamble can be at most 4000 characters.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.updateSkillStructural).not.toHaveBeenCalled();
  });

  it("a chat skill is unchanged: no badge, System prompt label, model + tools + sub-skills panels", async () => {
    const api = decisionApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));
    expect(await screen.findByLabelText("System prompt")).toBeTruthy();
    expect(screen.queryByLabelText("Preamble")).toBeNull();
    expect(screen.queryByTestId("skill-kind-badge")).toBeNull();
    expect(screen.queryByLabelText("Decision spec")).toBeNull();
    expect(await screen.findByLabelText("Model")).toBeTruthy();
    expect(screen.getByText("Sub-skills (orchestrator graph)")).toBeTruthy();
    expect(screen.getByText("Tools")).toBeTruthy();
    expect(await screen.findByTestId("role-row-main")).toBeTruthy();
    expect(screen.getByTestId("role-row-postflight_guard")).toBeTruthy();
  });
});

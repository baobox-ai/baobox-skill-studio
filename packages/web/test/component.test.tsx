import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import type { SkillDetail, SkillStudioApi } from "../src/api.js";
import { registerSkillBuilder } from "../src/element.js";
import { SkillStudio } from "../src/SkillStudio.js";

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

  it("loads parameters (secret masked) and saves the set", async () => {
    const api = mockApi({
      getParameters: vi.fn(async () => [
        { key: "account_id", value: "acct_1" },
        { key: "api_token", value: "", secret: true },
      ]),
    });
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    // first param value input carries the non-secret value
    const valueInputs = (await screen.findAllByLabelText("Parameter value")) as HTMLInputElement[];
    expect(valueInputs[0]?.value).toBe("acct_1");
    expect(valueInputs[1]?.value).toBe(""); // secret arrived masked
    fireEvent.click(screen.getByRole("button", { name: "Save parameters" }));
    await waitFor(() => expect(api.setParameters).toHaveBeenCalledWith("sk_1", expect.any(Array)));
  });
});

describe("registerSkillBuilder", () => {
  it("defines the custom element idempotently", () => {
    expect(registerSkillBuilder()).toBe("baobox-skill-builder");
    expect(customElements.get("baobox-skill-builder")).toBeTruthy();
    expect(() => registerSkillBuilder()).not.toThrow();
  });
});

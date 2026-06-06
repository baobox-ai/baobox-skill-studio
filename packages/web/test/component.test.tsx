import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import type { SkillStudioApi } from "../src/api.js";
import { registerSkillBuilder } from "../src/element.js";
import { SkillStudio } from "../src/SkillStudio.js";

const detail = {
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

function mockApi(over: Partial<SkillStudioApi> = {}): SkillStudioApi {
  return {
    listSkills: vi.fn(async () => [
      { id: "sk_1", name: "Invoice Chaser", description: "Chases invoices.", model: "MiniMax-M2.7", tenantId: "t_1", updatedAt: "x" },
      { id: "sk_2", name: "Support Triage", description: "Routes.", model: "MiniMax-M2.7", tenantId: null, updatedAt: "x" },
    ]),
    getSkill: vi.fn(async () => detail),
    updateSkill: vi.fn(async (_id, body) => ({ ...detail, ...body })),
    ...over,
  };
}

describe("<SkillStudio> component", () => {
  it("renders the skill list from the api", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi()} />);
    expect(await screen.findByText("Invoice Chaser")).toBeTruthy();
    expect(screen.getByText("Support Triage")).toBeTruthy();
  });

  it("opens detail on click and shows the editable description", async () => {
    const api = mockApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    const textarea = (await screen.findByLabelText("Description")) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Chases invoices.");
    expect(api.getSkill).toHaveBeenCalledWith("sk_1");
  });

  it("saves a single-field edit via api.updateSkill({ description })", async () => {
    const api = mockApi();
    render(<SkillStudio apiBase="/bff" api={api} />);
    fireEvent.click(await screen.findByText("Invoice Chaser"));

    const textarea = (await screen.findByLabelText("Description")) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "New copy" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.updateSkill).toHaveBeenCalledWith("sk_1", { description: "New copy" }));
    expect(await screen.findByText("Saved ✓")).toBeTruthy();
  });

  it("shows a config error and does NOT fetch when api-base is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<SkillStudio apiBase="" />); // no injected api → must not build a client or fetch
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

describe("registerSkillBuilder", () => {
  it("defines the custom element idempotently", () => {
    expect(registerSkillBuilder()).toBe("baobox-skill-builder");
    expect(customElements.get("baobox-skill-builder")).toBeTruthy();
    // second call must not throw
    expect(() => registerSkillBuilder()).not.toThrow();
  });
});

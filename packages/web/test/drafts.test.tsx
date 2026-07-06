// ED-2 (#433) — Tests for the IncomingDrafts surface.
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import type { SkillDraft, SkillStudioApi } from "../src/api.js";
import { SkillStudio } from "../src/SkillStudio.js";

const DRAFT: SkillDraft = {
  version_id: "skv_abc123",
  skill_id: "sk_def456",
  skill_name: "Invoice Classifier",
  version_label: "draft-abc123",
  review_state: "pending",
  is_active: 0,
  status: "draft",
  source: "external_dreamer",
  provenance: ["sess_aaa111", "sess_bbb222"],
  submitted_at: "2026-07-07T10:00:00.000Z",
  submitted_by_key_id: "skb_key001",
  tenant_id: "t_acme",
};

// Full SkillStudioApi stub — every method present.
function mockApi(over: Partial<SkillStudioApi> = {}): SkillStudioApi {
  return {
    listSkills: vi.fn(async () => []),
    getSkill: vi.fn(async () => { throw new Error("not used"); }),
    updateSkill: vi.fn(async () => { throw new Error("not used"); }),
    createSkill: vi.fn(async () => { throw new Error("not used"); }),
    updateSkillStructural: vi.fn(async () => { throw new Error("not used"); }),
    listAttachedSkills: vi.fn(async () => []),
    attachSubSkill: vi.fn(async () => {}),
    detachSubSkill: vi.fn(async () => {}),
    listTools: vi.fn(async () => []),
    attachTool: vi.fn(async () => {}),
    detachTool: vi.fn(async () => {}),
    getParameters: vi.fn(async () => []),
    setParameters: vi.fn(async (_id, params) => params),
    listAvailableTools: vi.fn(async () => { throw new Error("not supported"); }),
    listModels: vi.fn(async () => { throw new Error("not supported"); }),
    getRoleModels: vi.fn(async () => ({
      main: [],
      preflight_guard: [],
      postflight_guard: [],
      eval_judge: [],
    })),
    putRoleModels: vi.fn(async () => ({})),
    listLlmIntegrations: vi.fn(async () => []),
    listIntegrationModels: vi.fn(async () => ({
      integrationId: "",
      provider: "",
      models: [],
      providerListError: null,
    })),
    listDrafts: vi.fn(async () => []),
    approveDraft: vi.fn(async () => ({
      versionId: "skv_abc123",
      skillId: "sk_def456",
      reviewState: "approved",
      versionStatus: "active",
      skillStatus: "active",
    })),
    ...over,
  };
}

// Navigate to the "Incoming drafts" tab in the rendered studio.
async function openDraftsTab() {
  fireEvent.click(await screen.findByRole("tab", { name: "Incoming drafts" }));
}

describe("IncomingDrafts — list", () => {
  it("renders pending drafts from a mocked BFF response", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts: vi.fn(async () => [DRAFT]) })} />);
    await openDraftsTab();

    expect(await screen.findByText("Invoice Classifier")).toBeTruthy();
    expect(screen.getByText(/draft-abc123/)).toBeTruthy();
    expect(screen.getByText(/external_dreamer/)).toBeTruthy();
  });

  it("renders provenance session ids as plain text", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts: vi.fn(async () => [DRAFT]) })} />);
    await openDraftsTab();

    // Both session ids should be visible as text (no links)
    expect(await screen.findByText(/sess_aaa111/)).toBeTruthy();
    expect(screen.getByText(/sess_bbb222/)).toBeTruthy();
  });

  it("renders the empty state when there are no pending drafts", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts: vi.fn(async () => []) })} />);
    await openDraftsTab();

    expect(await screen.findByText(/No pending drafts/)).toBeTruthy();
  });

  it("renders an error state with a retry button when listDrafts fails", async () => {
    const listDrafts = vi.fn().mockRejectedValue(new Error("network error (upstream_error)"));
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts })} />);
    await openDraftsTab();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("reloads drafts when Retry is clicked after an error", async () => {
    const listDrafts = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([]);
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts })} />);
    await openDraftsTab();

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(listDrafts).toHaveBeenCalledTimes(2));
  });
});

describe("IncomingDrafts — approve", () => {
  it("shows a confirm dialog when Approve is clicked", async () => {
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts: vi.fn(async () => [DRAFT]) })} />);
    await openDraftsTab();

    fireEvent.click(await screen.findByRole("button", { name: /Approve draft draft-abc123/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("Cancel dismisses the confirm dialog without calling approveDraft", async () => {
    const approveDraft = vi.fn(async () => ({
      versionId: "skv_abc123",
      skillId: "sk_def456",
      reviewState: "approved",
      versionStatus: "active",
      skillStatus: "active",
    }));
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts: vi.fn(async () => [DRAFT]), approveDraft })} />);
    await openDraftsTab();

    fireEvent.click(await screen.findByRole("button", { name: /Approve draft draft-abc123/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(approveDraft).not.toHaveBeenCalled();
  });

  it("calls approveDraft with the correct versionId on confirm and refreshes the list", async () => {
    const approveDraft = vi.fn(async () => ({
      versionId: "skv_abc123",
      skillId: "sk_def456",
      reviewState: "approved",
      versionStatus: "active",
      skillStatus: "active",
    }));
    // After approval, the draft is gone.
    const listDrafts = vi
      .fn()
      .mockResolvedValueOnce([DRAFT])
      .mockResolvedValueOnce([]);
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts, approveDraft })} />);
    await openDraftsTab();

    fireEvent.click(await screen.findByRole("button", { name: /Approve draft draft-abc123/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve" }));

    await waitFor(() => expect(approveDraft).toHaveBeenCalledWith("skv_abc123"));
    // List is refreshed — empty state appears.
    await waitFor(() => expect(listDrafts).toHaveBeenCalledTimes(2));
  });

  it("shows an inline error inside the confirm dialog when approveDraft fails", async () => {
    const approveDraft = vi.fn(async () => {
      throw new Error("already approved (conflict)");
    });
    render(<SkillStudio apiBase="/bff" api={mockApi({ listDrafts: vi.fn(async () => [DRAFT]), approveDraft })} />);
    await openDraftsTab();

    fireEvent.click(await screen.findByRole("button", { name: /Approve draft draft-abc123/ }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/already approved/)).toBeTruthy();
    // Dialog stays open so the user can retry or cancel.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

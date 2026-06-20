import { useEffect, useRef, useState } from "preact/hooks";
import type {
  IntegrationModelsViewResponse,
  LlmIntegration,
  SkillDetail,
  SkillParameter,
  SkillStructuralUpdateRequest,
  SkillStudioApi,
  SkillSummary,
  SkillToolSummary,
} from "./api.js";
import { PerRoleModelPanel } from "./roleModels.js";
import {
  type CatalogProvider,
  type ModelFamily,
  MODEL_CATALOG,
  fetchModelCatalog,
  getModelFamily,
  getReasoningEfforts,
} from "./modelCatalog.js";
import type { Palette } from "./theme.js";
import {
  cardStyle,
  codeOf,
  ghostBtn,
  inputStyle,
  labelStyle,
  linkBtn,
  msgOf,
  primaryBtn,
  sectionTitle,
} from "./ui.js";

interface DetailProps {
  api: SkillStudioApi;
  palette: Palette;
  skillId: string;
  onBack: () => void;
  /** Navigate to another skill (used by "Copy as my own"). */
  onOpen: (skillId: string) => void;
}

// Editable structural fields the form manages.
type EditDraft = {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  temperature: string;
  maxTokens: string;
  // reasoningEffort is optional — only relevant for reasoning-family models.
  reasoningEffort: string;
  // #330 — integration-first picker. Empty string means "use tenant default"
  // (no pin). Non-empty binds to a specific integration id.
  llmIntegrationId: string;
};

function toDraft(d: SkillDetail): EditDraft {
  return {
    name: d.name,
    description: d.description,
    systemPrompt: d.systemPrompt,
    model: d.model,
    temperature: String(d.temperature),
    maxTokens: String(d.maxTokens),
    reasoningEffort: d.reasoningEffort ?? "medium",
    // Cast: SkillDetail may carry llmIntegrationId as a runtime additive field.
    llmIntegrationId: ((d as unknown as { llmIntegrationId?: string | null }).llmIntegrationId) ?? "",
  };
}

export function SkillDetailView({ api, palette: p, skillId, onBack, onOpen }: DetailProps) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    setDetail(null);
    api
      .getSkill(skillId)
      .then((d) => live && setDetail(d))
      .catch((err) => live && setError(msgOf(err)));
    return () => {
      live = false;
    };
  }, [api, skillId]);

  return (
    <div>
      <button type="button" onClick={onBack} style={linkBtn(p)}>
        ← Back to skills
      </button>

      {error && (
        <div role="alert" style={{ color: p.danger, margin: "0.5rem 0" }}>
          {error}
        </div>
      )}
      {!detail && !error && <p style={{ color: p.muted }}>Loading…</p>}

      {detail &&
        (detail.isSystem ? (
          <ReadOnlySkill api={api} palette={p} detail={detail} onOpen={onOpen} />
        ) : (
          <EditableSkill api={api} palette={p} detail={detail} onReload={setDetail} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System (platform) skill — BaoBox#264 Defect B: a system skill is READ-ONLY for
// a tenant. If it is `cloneable`, offer "Copy as my own" → creates a tenant-owned
// copy the tenant can then edit.
// ---------------------------------------------------------------------------
function ReadOnlySkill({
  api,
  palette: p,
  detail,
  onOpen,
}: {
  api: SkillStudioApi;
  palette: Palette;
  detail: SkillDetail;
  onOpen: (id: string) => void;
}) {
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clone() {
    setCloning(true);
    setError(null);
    try {
      const copy = await api.createSkill({
        name: `${detail.name} (copy)`,
        description: detail.description,
        systemPrompt: detail.systemPrompt,
        model: detail.model,
        temperature: detail.temperature,
        maxTokens: detail.maxTokens,
        ...(detail.sourceUrl ? { sourceUrl: detail.sourceUrl } : {}),
      });
      onOpen(copy.id);
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setCloning(false);
    }
  }

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 0.25rem" }}>{detail.name}</h2>
      <div style={{ color: p.muted, fontSize: "0.8rem", marginBottom: "0.5rem" }}>
        {detail.id} · {detail.model}
      </div>
      <div
        role="note"
        style={{ ...cardStyle(p), fontSize: "0.85rem", marginBottom: "0.75rem" }}
      >
        <strong>System skill — read-only.</strong>{" "}
        {detail.cloneable
          ? "Copy it as your own to customize it."
          : "This platform skill can't be edited by your tenant."}
      </div>

      {detail.cloneable && (
        <div style={{ marginBottom: "0.75rem" }}>
          <button type="button" disabled={cloning} onClick={() => void clone()} style={primaryBtn(p, cloning)}>
            {cloning ? "Copying…" : "Copy as my own"}
          </button>
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: p.danger, marginBottom: "0.5rem" }}>
          {error}
        </div>
      )}

      <label style={labelStyle()}>Description</label>
      <p style={{ ...cardStyle(p), margin: 0, fontSize: "0.9rem" }}>{detail.description || "—"}</p>

      <details style={{ marginTop: "0.75rem" }}>
        <summary style={{ cursor: "pointer", color: p.muted }}>System prompt</summary>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: p.card,
            border: `1px solid ${p.border}`,
            borderRadius: "6px",
            padding: "0.5rem",
            fontSize: "0.8rem",
          }}
        >
          {detail.systemPrompt}
        </pre>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Integration-first model picker (#330).
//
// Flow:
//   1. "LLM integration" <select> — the tenant's configured integrations from
//      GET /llm-integrations. Includes a "Use tenant default" sentinel (empty
//      value). If no integrations are configured, falls back gracefully to the
//      existing free-text/catalog model entry.
//   2. On integration select → fetch GET /llm-integrations/:id/models → model
//      <select> listing ONLY that integration's models.
//   3. The param panel (temperature/maxTokens vs reasoningEffort) keys off the
//      selected model's paramProfile from the integration model list.
//   4. Save sends { llmIntegrationId, model, llmSource: integrationId ?
//      "pinned" : "tenant_default" }.
//
// Graceful degradation:
//   - No integrations → message + free-text/catalog model input.
//   - Loading → disabled selects with placeholder text.
//   - providerListError → soft note below model select.
// ---------------------------------------------------------------------------

/** Sentinel value meaning "no explicit integration — use tenant default". */
const PLATFORM_OPTION = "" as const;

function IntegrationModelPicker({
  integrationId,
  model,
  onIntegrationChange,
  onModelChange,
  palette: p,
  disabled,
  integrations,
  integrationsLoading,
  modelsView,
  modelsLoading,
  catalog,
}: {
  integrationId: string;
  model: string;
  onIntegrationChange: (id: string) => void;
  onModelChange: (model: string) => void;
  palette: Palette;
  disabled?: boolean;
  integrations: LlmIntegration[] | null;
  integrationsLoading: boolean;
  modelsView: IntegrationModelsViewResponse | null;
  modelsLoading: boolean;
  /** Fallback catalog — used when no integrations are configured. */
  catalog: CatalogProvider[];
}) {
  // No integrations configured → fall back to free-text catalog input.
  if (!integrationsLoading && integrations !== null && integrations.length === 0) {
    const MODEL_DATALIST_ID = "bb-skill-model-list-fallback";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        <div role="note" style={{ fontSize: "0.78rem", opacity: 0.65 }}>
          No LLM integrations configured for this tenant. Enter a model id directly.
        </div>
        <input
          id="bb-model"
          type="text"
          aria-label="Model"
          list={MODEL_DATALIST_ID}
          value={model}
          disabled={disabled}
          onInput={(e) => onModelChange((e.currentTarget as HTMLInputElement).value)}
          style={inputStyle(p)}
          placeholder="e.g. openai/gpt-5"
          autoComplete="off"
        />
        <datalist id={MODEL_DATALIST_ID}>
          {catalog.map((provider) =>
            provider.models.map((m) => (
              <option key={m.id} value={m.id}>
                {provider.label} / {m.label}
              </option>
            )),
          )}
        </datalist>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      {/* Step 1 — integration selector */}
      <div>
        <label style={labelStyle()} for="bb-integration">
          LLM integration
        </label>
        <select
          id="bb-integration"
          aria-label="LLM integration"
          value={integrationId}
          disabled={disabled || integrationsLoading}
          onChange={(e) => onIntegrationChange((e.currentTarget as HTMLSelectElement).value)}
          style={inputStyle(p)}
        >
          <option value={PLATFORM_OPTION}>
            {integrationsLoading ? "Loading integrations…" : "— Use tenant default —"}
          </option>
          {(integrations ?? []).map((intg) => (
            <option key={intg.id} value={intg.id}>
              {intg.displayName} ({intg.provider})
              {intg.isDefault ? " ★" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Step 2 — model selector (only when an integration is pinned) */}
      {integrationId !== PLATFORM_OPTION && (
        <div>
          <label style={labelStyle()} for="bb-model">
            Model
          </label>
          <select
            id="bb-model"
            aria-label="Model"
            value={model}
            disabled={disabled || modelsLoading}
            onChange={(e) => onModelChange((e.currentTarget as HTMLSelectElement).value)}
            style={inputStyle(p)}
          >
            <option value="">
              {modelsLoading
                ? "Loading models…"
                : modelsView && modelsView.models.length === 0
                  ? "No models available"
                  : "— Select a model —"}
            </option>
            {(modelsView?.models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          {modelsView?.providerListError && (
            <div role="note" style={{ fontSize: "0.75rem", opacity: 0.65, marginTop: "0.2rem" }}>
              Note: live provider model list unavailable ({modelsView.providerListError}). Showing catalog models only.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model-family-aware parameter panel (#302).
//   - reasoning models → reasoningEffort selector (options driven by the
//     selected model's valid set via getReasoningEfforts), no temperature/maxTokens
//   - sampling models (or unknown/free-text) → temperature + maxTokens, no
//     reasoningEffort
// ---------------------------------------------------------------------------

// Human-readable labels for each effort value.
const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

function ModelParamPanel({
  model,
  modelFamily,
  temperature,
  maxTokens,
  reasoningEffort,
  onTemperature,
  onMaxTokens,
  onReasoningEffort,
  palette: p,
  disabled,
  catalog,
  effortOptions: effortOptionsProp,
}: {
  model: string;
  modelFamily: ModelFamily | undefined;
  temperature: string;
  maxTokens: string;
  reasoningEffort: string;
  onTemperature: (v: string) => void;
  onMaxTokens: (v: string) => void;
  onReasoningEffort: (v: string) => void;
  palette: Palette;
  disabled?: boolean;
  /** Active model catalog — live from BFF when available, static fallback otherwise. */
  catalog: CatalogProvider[];
  /**
   * Optional override for reasoning effort options — supplied by the caller
   * when it already has the model's effort set from the integration model list
   * (more precise than the static catalog). Falls back to catalog lookup when absent.
   */
  effortOptions?: string[];
}) {
  if (modelFamily === "reasoning") {
    // Use caller-supplied effort set (from integration model list) when available;
    // fall back to catalog lookup for free-text / catalog-only models.
    const effortOptions = effortOptionsProp ?? getReasoningEfforts(model, catalog) ?? ["minimal", "low", "medium", "high"];
    return (
      <div style={{ flex: 2 }}>
        <label style={labelStyle()} for="bb-effort">
          Reasoning Effort
        </label>
        <select
          id="bb-effort"
          aria-label="Reasoning Effort"
          value={reasoningEffort}
          disabled={disabled}
          onChange={(e) => onReasoningEffort((e.currentTarget as HTMLSelectElement).value)}
          style={inputStyle(p)}
        >
          {effortOptions.map((v) => (
            <option key={v} value={v}>
              {EFFORT_LABELS[v] ?? v}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // sampling family (or unknown/free-text model) — show temperature + maxTokens
  return (
    <>
      <div style={{ flex: 1 }}>
        <label style={labelStyle()} for="bb-temp">
          Temperature
        </label>
        <input
          id="bb-temp"
          aria-label="Temperature"
          type="number"
          step="0.1"
          min="0"
          max="2"
          value={temperature}
          disabled={disabled}
          onInput={(e) => onTemperature((e.currentTarget as HTMLInputElement).value)}
          style={inputStyle(p)}
        />
      </div>
      <div style={{ flex: 1 }}>
        <label style={labelStyle()} for="bb-max">
          Max Tokens
        </label>
        <input
          id="bb-max"
          aria-label="Max Tokens"
          type="number"
          min="1"
          value={maxTokens}
          disabled={disabled}
          onInput={(e) => onMaxTokens((e.currentTarget as HTMLInputElement).value)}
          style={inputStyle(p)}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tenant-owned skill — full structural edit + orchestrator panels.
// ---------------------------------------------------------------------------
function EditableSkill({
  api,
  palette: p,
  detail,
  onReload,
}: {
  api: SkillStudioApi;
  palette: Palette;
  detail: SkillDetail;
  onReload: (d: SkillDetail) => void;
}) {
  // Seed once from the loaded detail (initializer — NOT an effect, which would
  // run after the first paint and clobber an in-flight edit). The form is
  // re-seeded explicitly from the server's response after a successful save.
  const [draft, setDraft] = useState<EditDraft>(() => toDraft(detail));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // #320 — live model catalog. Load once per api instance; used as the fallback
  // catalog when no integrations are configured and for the ModelParamPanel
  // when the model family cannot be derived from the integration model list.
  const [catalog, setCatalog] = useState<CatalogProvider[]>(MODEL_CATALOG);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per api instance
  useEffect(() => {
    fetchModelCatalog(api).then((live) => {
      if (live) setCatalog(live);
    });
  }, [api]);

  // #330 — integration-first picker state.
  // `null` = not yet loaded; `[]` = loaded but none configured (triggers fallback).
  const [integrations, setIntegrations] = useState<LlmIntegration[] | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  // `null` = no integration selected or not yet loaded.
  const [modelsView, setModelsView] = useState<IntegrationModelsViewResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Load the tenant's integrations once per api instance.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per api instance
  useEffect(() => {
    setIntegrationsLoading(true);
    api
      .listLlmIntegrations()
      .then((list) => {
        setIntegrations(list);
        setIntegrationsLoading(false);
      })
      .catch(() => {
        // On failure, treat as "no integrations" so the free-text fallback activates.
        setIntegrations([]);
        setIntegrationsLoading(false);
      });
  }, [api]);

  // When the selected integration changes, fetch its model list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — react to draft.llmIntegrationId
  useEffect(() => {
    if (!draft.llmIntegrationId) {
      setModelsView(null);
      return;
    }
    setModelsLoading(true);
    api
      .listIntegrationModels(draft.llmIntegrationId)
      .then((view) => {
        setModelsView(view);
        setModelsLoading(false);
      })
      .catch(() => {
        setModelsView(null);
        setModelsLoading(false);
      });
  }, [api, draft.llmIntegrationId]);

  function set<K extends keyof EditDraft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  // When the integration changes, reset the model selection (the new integration
  // may not have the previously-selected model in its list).
  function handleIntegrationChange(integrationId: string) {
    setDraft((d) => ({ ...d, llmIntegrationId: integrationId, model: "" }));
    setSaved(false);
  }

  // Derive the model family for the param panel.
  // Priority: integration model list (precise) → static catalog (fallback).
  function getModelFamilyForDraft(): ModelFamily | undefined {
    if (draft.llmIntegrationId && modelsView) {
      const found = modelsView.models.find((m) => m.id === draft.model);
      if (found) return found.paramProfile as ModelFamily;
    }
    return getModelFamily(draft.model, catalog);
  }

  // Derive reasoning efforts for the selected model from the integration list
  // (more precise than the static catalog's effort sets).
  function getReasoningEffortsForDraft(): string[] | undefined {
    if (draft.llmIntegrationId && modelsView) {
      const found = modelsView.models.find((m) => m.id === draft.model);
      if (found && found.paramProfile === "reasoning") {
        return found.reasoningEfforts.length > 0
          ? found.reasoningEfforts
          : ["minimal", "low", "medium", "high"];
      }
      if (found && found.paramProfile === "sampling") return undefined;
    }
    return getReasoningEfforts(draft.model, catalog);
  }

  const modelFamily = getModelFamilyForDraft();

  // Validate the numeric fields against the contract's bounds before they can be
  // marked dirty / submitted (temperature 0–2; maxTokens a positive integer).
  // Skip numeric validation for reasoning models (those fields aren't sent).
  const tempNum = Number(draft.temperature);
  const tempInvalid =
    modelFamily !== "reasoning" &&
    draft.temperature.trim() !== "" &&
    (!Number.isFinite(tempNum) || tempNum < 0 || tempNum > 2);
  const maxNum = Number(draft.maxTokens);
  const maxInvalid =
    modelFamily !== "reasoning" &&
    draft.maxTokens.trim() !== "" &&
    (!Number.isInteger(maxNum) || maxNum < 1);
  const numericError = tempInvalid
    ? "Temperature must be a number between 0 and 2."
    : maxInvalid
      ? "Max tokens must be a positive integer."
      : null;

  // Detail's server-side llmIntegrationId (additive runtime field).
  const detailIntegrationId =
    ((detail as unknown as { llmIntegrationId?: string | null }).llmIntegrationId) ?? "";

  // Diff the draft against the loaded detail; only changed (and VALID) fields are sent.
  function changedFields(): SkillStructuralUpdateRequest {
    const out: SkillStructuralUpdateRequest = {};
    if (draft.name !== detail.name) out.name = draft.name;
    if (draft.description !== detail.description) out.description = draft.description;
    if (draft.systemPrompt !== detail.systemPrompt) out.systemPrompt = draft.systemPrompt;
    if (draft.model !== detail.model) out.model = draft.model;
    if (modelFamily !== "reasoning") {
      if (!tempInvalid && draft.temperature.trim() !== "" && tempNum !== detail.temperature) {
        out.temperature = tempNum;
      }
      if (!maxInvalid && draft.maxTokens.trim() !== "" && maxNum !== detail.maxTokens) {
        out.maxTokens = maxNum;
      }
    }
    // #330 — always include integration binding when an integration is pinned
    // OR when the user clears it (to send llmSource: "tenant_default").
    if (draft.llmIntegrationId !== detailIntegrationId) {
      out.llmIntegrationId = draft.llmIntegrationId || null;
      out.llmSource = draft.llmIntegrationId ? "pinned" : "tenant_default";
    }
    return out;
  }

  const dirty = !numericError && Object.keys(changedFields()).length > 0;

  async function save() {
    if (numericError) return;
    const changes = changedFields();
    if (Object.keys(changes).length === 0) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateSkillStructural(detail.id, changes);
      onReload(updated);
      setDraft(toDraft(updated)); // re-seed from the server's canonical values
      setSaved(true);
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setSaving(false);
    }
  }

  // Build reasoning effort options for the ModelParamPanel — prefer the
  // integration model list's precise set; fall back to catalog.
  const reasoningEffortOptions = getReasoningEffortsForDraft();

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 0.25rem" }}>{detail.name}</h2>
      <div style={{ color: p.muted, fontSize: "0.8rem", marginBottom: "0.5rem" }}>
        {detail.id}
        {detail.tenantId === null ? " · global" : ""}
      </div>

      {error && (
        <div role="alert" style={{ color: p.danger, margin: "0.5rem 0" }}>
          {error}
        </div>
      )}

      <label style={labelStyle()} for="bb-name">
        Name
      </label>
      <input
        id="bb-name"
        aria-label="Name"
        value={draft.name}
        onInput={(e) => set("name", (e.currentTarget as HTMLInputElement).value)}
        style={inputStyle(p)}
      />

      <label style={labelStyle()} for="bb-desc">
        Description
      </label>
      <textarea
        id="bb-desc"
        aria-label="Description"
        value={draft.description}
        rows={2}
        onInput={(e) => set("description", (e.currentTarget as HTMLTextAreaElement).value)}
        style={inputStyle(p)}
      />

      <label style={labelStyle()} for="bb-prompt">
        System prompt
      </label>
      <textarea
        id="bb-prompt"
        aria-label="System prompt"
        value={draft.systemPrompt}
        rows={5}
        onInput={(e) => set("systemPrompt", (e.currentTarget as HTMLTextAreaElement).value)}
        style={inputStyle(p)}
      />

      {/* #330 — Integration-first model picker + family-aware parameter panel */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ flex: 2, minWidth: "200px" }}>
          <IntegrationModelPicker
            integrationId={draft.llmIntegrationId}
            model={draft.model}
            onIntegrationChange={handleIntegrationChange}
            onModelChange={(v) => set("model", v)}
            palette={p}
            disabled={saving}
            integrations={integrations}
            integrationsLoading={integrationsLoading}
            modelsView={modelsView}
            modelsLoading={modelsLoading}
            catalog={catalog}
          />
        </div>
        {/* Only show param panel when a model is selected or we're in fallback (no integration) */}
        {(draft.model || (!draft.llmIntegrationId && !integrationsLoading)) && (
          <ModelParamPanel
            model={draft.model}
            modelFamily={modelFamily}
            temperature={draft.temperature}
            maxTokens={draft.maxTokens}
            reasoningEffort={draft.reasoningEffort}
            onTemperature={(v) => set("temperature", v)}
            onMaxTokens={(v) => set("maxTokens", v)}
            onReasoningEffort={(v) => set("reasoningEffort", v)}
            palette={p}
            disabled={saving}
            catalog={catalog}
            effortOptions={reasoningEffortOptions}
          />
        )}
      </div>

      {numericError && (
        <div role="alert" style={{ color: p.danger, fontSize: "0.8rem", marginTop: "0.4rem" }}>
          {numericError}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.6rem" }}>
        <button type="button" disabled={!dirty || saving} onClick={() => void save()} style={primaryBtn(p, !dirty || saving)}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && !dirty && <span style={{ color: p.success, fontSize: "0.85rem" }}>Saved ✓</span>}
      </div>

      <SubSkillsPanel api={api} palette={p} skillId={detail.id} />
      <ToolsPanel api={api} palette={p} skillId={detail.id} />
      <ParametersPanel api={api} palette={p} skillId={detail.id} />
      <PerRoleModelPanel api={api} palette={p} skillId={detail.id} catalog={catalog} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orchestrator sub-skill graph — attach/detach children, with cycle-rejection UX.
// ---------------------------------------------------------------------------
function SubSkillsPanel({ api, palette: p, skillId }: { api: SkillStudioApi; palette: Palette; skillId: string }) {
  const [attached, setAttached] = useState<SkillSummary[] | null>(null);
  const [candidates, setCandidates] = useState<SkillSummary[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const [children, all] = await Promise.all([api.listAttachedSkills(skillId), api.listSkills()]);
      setAttached(children);
      const attachedIds = new Set(children.map((c) => c.id));
      // Offer every other skill as a candidate; the server still rejects a cycle.
      setCandidates(all.filter((s) => s.id !== skillId && !attachedIds.has(s.id)));
    } catch (err) {
      setError(msgOf(err));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per (api, skillId)
  useEffect(() => {
    void reload();
  }, [api, skillId]);

  async function attach() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      await api.attachSubSkill(skillId, pick);
      setPick("");
      await reload();
    } catch (err) {
      // Surface the contract cycle code as a human-readable graph error.
      setError(
        codeOf(err) === "cycle_detected"
          ? "Attaching that skill would create a cycle in the orchestrator graph."
          : msgOf(err),
      );
    } finally {
      setBusy(false);
    }
  }

  async function detach(childId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.detachSubSkill(skillId, childId);
      await reload();
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 style={sectionTitle()}>Sub-skills (orchestrator graph)</h3>
      {error && (
        <div role="alert" style={{ color: p.danger, marginBottom: "0.5rem", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}

      {/* DAG view: this skill → its attached children. */}
      <div style={{ ...cardStyle(p), fontSize: "0.85rem" }}>
        <div style={{ fontWeight: 600 }}>{skillId}</div>
        {attached === null ? (
          <div style={{ color: p.muted }}>Loading…</div>
        ) : attached.length === 0 ? (
          <div style={{ color: p.muted, paddingLeft: "1rem" }}>└ no sub-skills attached</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: "0.25rem 0 0 1rem" }}>
            {attached.map((c) => (
              <li
                key={c.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.15rem 0" }}
              >
                <span>
                  └ {c.name} <span style={{ color: p.muted }}>· {c.id}</span>
                </span>
                <button type="button" disabled={busy} onClick={() => void detach(c.id)} style={linkBtn(p)}>
                  Detach
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <select
          aria-label="Attach a sub-skill"
          value={pick}
          onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)}
          style={{ ...inputStyle(p), flex: 1 }}
        >
          <option value="">Attach a sub-skill…</option>
          {candidates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.id})
            </option>
          ))}
        </select>
        <button type="button" disabled={!pick || busy} onClick={() => void attach()} style={ghostBtn(p)}>
          Attach
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tool wiring — attach/detach tools. The tenant tool allowlist is enforced
// server-side: an off-list tool attach is rejected with `tool_not_allowed`,
// surfaced here.
//
// Picker strategy (#312): on mount, attempt to load the tenant's attachable
// tool allowlist via `listAvailableTools()`. On success, show a <select>
// excluding already-attached tools. On failure (BFF not yet upgraded, or the
// op is denied), fall back silently to the original attach-by-id free-text
// input — the server remains the allowlist authority in both cases, and the
// `tool_not_allowed` error handling is the safety net regardless of which
// input mode is active.
// ---------------------------------------------------------------------------
function ToolsPanel({ api, palette: p, skillId }: { api: SkillStudioApi; palette: Palette; skillId: string }) {
  const [tools, setTools] = useState<SkillToolSummary[] | null>(null);
  // `null` = loading, `SkillToolSummary[]` = loaded (may be empty), `false` = failed
  const [available, setAvailable] = useState<SkillToolSummary[] | false | null>(null);
  // picker selection (id) when using the allowlist dropdown
  const [pick, setPick] = useState("");
  // free-text fallback when the allowlist call fails
  const [toolId, setToolId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      setTools(await api.listTools(skillId));
    } catch (err) {
      setError(msgOf(err));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per (api, skillId)
  useEffect(() => {
    void reload();
  }, [api, skillId]);

  // Load the attachable allowlist once per (api) mount. Failure → fall back to
  // free-text. Reset the pick selection whenever the attached list refreshes so
  // we don't offer an already-attached tool.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — load once per api instance
  useEffect(() => {
    setAvailable(null);
    api
      .listAvailableTools()
      .then((list) => setAvailable(list))
      .catch(() => setAvailable(false));
  }, [api]);

  // Candidates = available tools that are not already attached.
  const candidates: SkillToolSummary[] =
    available && tools
      ? available.filter((a) => !tools.some((t) => t.id === a.id))
      : [];

  async function attach() {
    // Use the picker id when the allowlist is available, otherwise fall back to
    // the free-text input. The server is the authority either way.
    const id = (available !== false ? pick : toolId).trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.attachTool(skillId, id);
      setPick("");
      setToolId("");
      await reload();
    } catch (err) {
      setError(
        codeOf(err) === "tool_not_allowed"
          ? `Tool "${id}" isn't on your allowlist — ask your operator to permit it.`
          : msgOf(err),
      );
    } finally {
      setBusy(false);
    }
  }

  async function detach(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.detachTool(skillId, id);
      await reload();
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setBusy(false);
    }
  }

  // Whether the picker (allowlist dropdown) is active vs. the free-text fallback.
  const usePicker = available !== false;
  // Disable the Attach button: busy, or nothing selected in whichever input is active.
  const attachDisabled = busy || (usePicker ? !pick : !toolId.trim());

  return (
    <section>
      <h3 style={sectionTitle()}>Tools</h3>
      {error && (
        <div role="alert" style={{ color: p.danger, marginBottom: "0.5rem", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}
      {tools === null ? (
        <p style={{ color: p.muted }}>Loading…</p>
      ) : tools.length === 0 ? (
        <p style={{ color: p.muted, fontSize: "0.85rem" }}>No tools attached.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.4rem" }}>
          {tools.map((t) => (
            <li key={t.id} style={{ ...cardStyle(p), display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem" }}>
                <strong>{t.name}</strong> <span style={{ color: p.muted }}>· {t.id}</span>
                <div style={{ color: p.muted }}>{t.description}</div>
              </span>
              <button type="button" disabled={busy} onClick={() => void detach(t.id)} style={linkBtn(p)}>
                Detach
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        {usePicker ? (
          // Allowlist picker — excludes already-attached tools.
          <select
            aria-label="Attach a tool"
            value={pick}
            onChange={(e) => setPick((e.currentTarget as HTMLSelectElement).value)}
            style={{ ...inputStyle(p), flex: 1 }}
            disabled={available === null || busy}
          >
            <option value="">
              {available === null ? "Loading tools…" : candidates.length === 0 ? "No tools available" : "Attach a tool…"}
            </option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.id})
              </option>
            ))}
          </select>
        ) : (
          // Free-text fallback — used when listAvailableTools() fails (e.g. BFF
          // not yet upgraded). The server allowlist still gates every attach.
          <input
            aria-label="Tool id to attach"
            placeholder="Tool id (e.g. tl_…)"
            value={toolId}
            onInput={(e) => setToolId((e.currentTarget as HTMLInputElement).value)}
            style={{ ...inputStyle(p), flex: 1 }}
          />
        )}
        <button type="button" disabled={attachDisabled} onClick={() => void attach()} style={ghostBtn(p)}>
          Attach tool
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Per-tenant parameters — key/value (+ optional label, secret). The contract's
// PUT replaces the whole set. Secret values arrive masked (blank); they are
// write-only here — re-enter a secret to change it.
// ---------------------------------------------------------------------------
// `_loadedSecret` marks a secret that arrived already-set from the server (its
// value is masked/blank — the browser is never allowed to read it). Per the
// contract, a `secret: true` row carried with an **empty value** is the
// documented **"keep the current value"** signal: the BFF's parameter store
// retains the stored secret rather than overwriting it with the blank. Typing a
// new value replaces the secret; removing the row deletes it. (`_loadedSecret`
// is a local-only flag — stripped from the PUT payload.)
type ParamRow = SkillParameter & { _id: number; _loadedSecret?: boolean };

function ParametersPanel({ api, palette: p, skillId }: { api: SkillStudioApi; palette: Palette; skillId: string }) {
  const [rows, setRows] = useState<ParamRow[] | null>(null);
  const idRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextId = (): number => {
    idRef.current += 1;
    return idRef.current;
  };

  // Re-seed rows from a server list, assigning stable local ids. A secret comes
  // back with its value masked (blank); flag it so a blank-on-save means "keep".
  function seedRows(params: SkillParameter[]) {
    setRows(params.map((param, i) => ({ ...param, _id: i, _loadedSecret: !!param.secret })));
    idRef.current = params.length;
  }

  async function reload() {
    setError(null);
    try {
      seedRows(await api.getParameters(skillId));
    } catch (err) {
      setError(msgOf(err));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is stable per (api, skillId)
  useEffect(() => {
    void reload();
  }, [api, skillId]);

  function update(id: number, patch: Partial<ParamRow>) {
    setRows((rs) => (rs ? rs.map((r) => (r._id === id ? { ...r, ...patch } : r)) : rs));
    setSaved(false);
  }
  function addRow() {
    setRows((rs) => [...(rs ?? []), { key: "", value: "", _id: nextId() }]);
    setSaved(false);
  }
  function removeRow(id: number) {
    setRows((rs) => (rs ? rs.filter((r) => r._id !== id) : rs));
    setSaved(false);
  }

  async function save() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // Strip local-only fields; a kept secret (loaded, untouched) goes up as
      // `{ secret: true, value: "" }` — the contract's "keep current" signal.
      const payload: SkillParameter[] = rows.map(({ _id, _loadedSecret, ...param }) => param);
      seedRows(await api.setParameters(skillId, payload));
      setSaved(true);
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 style={sectionTitle()}>Parameters</h3>
      <p style={{ color: p.muted, fontSize: "0.8rem", margin: "0 0 0.5rem" }}>
        Per-tenant values injected without editing the prompt. A secret is hidden — leave it blank to
        keep the stored value, type a new one to replace it, or remove the row to delete it.
      </p>
      {error && (
        <div role="alert" style={{ color: p.danger, marginBottom: "0.5rem", fontSize: "0.85rem" }}>
          {error}
        </div>
      )}
      {rows === null ? (
        <p style={{ color: p.muted }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gap: "0.4rem" }}>
          {rows.map((r) => (
            <div key={r._id} style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                aria-label="Parameter key"
                placeholder="key"
                value={r.key}
                onInput={(e) => update(r._id, { key: (e.currentTarget as HTMLInputElement).value })}
                style={{ ...inputStyle(p), flex: 1 }}
              />
              <input
                aria-label="Parameter value"
                placeholder={r._loadedSecret ? "•••• unchanged — type to replace" : r.secret ? "secret value" : "value"}
                type={r.secret ? "password" : "text"}
                value={r.value}
                // Typing into a kept secret turns it into a real replacement: clear the
                // "loaded secret" flag so the new value is sent (not treated as "keep").
                onInput={(e) =>
                  update(r._id, {
                    value: (e.currentTarget as HTMLInputElement).value,
                    ...(r._loadedSecret ? { _loadedSecret: false } : {}),
                  })
                }
                style={{ ...inputStyle(p), flex: 2 }}
              />
              <label style={{ fontSize: "0.8rem", color: p.muted, display: "flex", alignItems: "center", gap: "0.2rem" }}>
                <input
                  type="checkbox"
                  aria-label="Secret"
                  checked={!!r.secret}
                  onChange={(e) => update(r._id, { secret: (e.currentTarget as HTMLInputElement).checked })}
                />
                secret
              </label>
              <button type="button" onClick={() => removeRow(r._id)} style={linkBtn(p)} aria-label="Remove parameter">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
        <button type="button" onClick={addRow} style={ghostBtn(p)}>
          + Add parameter
        </button>
        <button type="button" disabled={busy || rows === null} onClick={() => void save()} style={primaryBtn(p, busy || rows === null)}>
          {busy ? "Saving…" : "Save parameters"}
        </button>
        {saved && <span style={{ color: p.success, fontSize: "0.85rem" }}>Saved ✓</span>}
      </div>
    </section>
  );
}

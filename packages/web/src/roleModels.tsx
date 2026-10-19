// ---------------------------------------------------------------------------
// Per-role models & fallback panel (#328).
//
// Mirrors the BaoBox tenant portal's "Per-role models & fallback" card, adapted
// to the Studio's Preact / web-component stack and catalog-only model picker
// (no off-box integration list — see scope decision in #328).
//
// Coverage:
//   preflight_guard  — PRIMARY model + optional BACKUP
//   postflight_guard — PRIMARY model + optional BACKUP (chat skills only)
//   main             — BACKUP only (its primary is the skill's main model;
//                      chat skills only)
//
// Each save does a PUT /skills/:id/role-models with { role, chain } where chain
// is the non-empty slots in order as
//   { llmIntegrationId: null, model, llmSource: "tenant_default", mode: "chat" }.
// An empty selection means "clear / inherit tenant default" (chain = []).
//
// baobox#846 — why `tenant_default` and not `pinned`: BaoBox requires an
// `llmIntegrationId` on every `pinned` entry and rejects `pinned` + null with
// 400 `invalid_role_model` ("llmSource 'pinned' requires an llmIntegrationId"). Studio has
// no integration picker on these slots, so it sends `tenant_default`: the
// entry runs on the tenant's default LLM integration, and the chosen model is
// honoured when it belongs to that integration's provider, else the
// integration's default model is used (baobox#827).
//
// Chains Studio cannot represent are shown READ-ONLY (Save / Inherit disabled):
// a `mode: "decision"` entry (a decision-model guard, set in the Portal), or a
// chat entry pinned to an integration / on the platform key. Re-saving such a
// chain from Studio would silently replace it with tenant-default entries.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "preact/hooks";
import type { PutRoleModelsRequest, SkillRoleModelsMap, SkillStudioApi } from "./api.js";
import type { CatalogProvider } from "./modelCatalog.js";
import type { Palette } from "./theme.js";
import {
  cardStyle,
  ghostBtn,
  inputStyle,
  labelStyle,
  msgOf,
  primaryBtn,
  sectionTitle,
} from "./ui.js";

// The guard roles that get a PRIMARY + BACKUP slot each.
const GUARD_ROLES = [
  { key: "preflight_guard" as const, label: "Preflight guard" },
  { key: "postflight_guard" as const, label: "Postflight guard" },
];

type ChainEntry = PutRoleModelsRequest["chain"][number];
type StoredChain = SkillRoleModelsMap["main"];

// Build the chain entry Studio writes for a catalog model: the tenant's default
// integration, this model, chat mode (see the header comment for why).
export function guardEntry(model: string): ChainEntry {
  return { llmIntegrationId: null, model, llmSource: "tenant_default", mode: "chat" };
}

/** True when any entry of a stored chain runs on a decision model. */
export function hasDecisionEntry(chain: StoredChain): boolean {
  return chain.some((e) => e.mode === "decision");
}

// Why a stored chain is read-only in Studio, or null when Studio can edit it.
// Studio can only write `guardEntry` shapes, so anything else is preserved by
// refusing to save over it.
export function readOnlyReason(chain: StoredChain): string | null {
  if (hasDecisionEntry(chain)) {
    return "Decision-model pin — set in the Portal (decision model). Shown read-only so Studio never replaces it.";
  }
  const foreign = chain.some(
    (e) => e.llmSource !== "tenant_default" || e.llmIntegrationId !== null || !e.model,
  );
  if (foreign) {
    return "Pinned to a specific LLM integration — set in the Portal. Shown read-only so Studio never replaces it.";
  }
  return null;
}

function entryLabel(e: StoredChain[number]): string {
  const model = e.model ?? "(provider default)";
  return e.mode === "decision" ? `${model} · decision` : model;
}

// Caption under each guard slot (baobox#827 same-provider rule).
const TENANT_DEFAULT_CAPTION =
  "Runs on your tenant's default LLM integration. If the model you pick is from a different provider than that integration, the integration's default model is used instead.";

// ---------------------------------------------------------------------------
// Flat model <select> from the catalog — catalog-driven, no free-text (guard
// slots must be explicit catalog picks so the user can't accidentally typo a
// model id into a guardrail chain).
// ---------------------------------------------------------------------------
function CatalogSelect({
  id,
  value,
  onChange,
  catalog,
  palette: p,
  disabled,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  catalog: CatalogProvider[];
  palette: Palette;
  disabled?: boolean;
  placeholder: string;
}) {
  return (
    <select
      id={id}
      aria-label={placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
      style={inputStyle(p)}
    >
      <option value="">{placeholder}</option>
      {catalog.map((provider) =>
        provider.models.map((m) => (
          <option key={m.id} value={m.id}>
            {provider.label} / {m.label}
          </option>
        )),
      )}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Guard role row — PRIMARY + BACKUP model selects + Save / Inherit default.
// ---------------------------------------------------------------------------
function GuardRoleRow({
  label,
  roleKey,
  chain,
  catalog,
  palette: p,
  onSave,
}: {
  label: string;
  roleKey: "preflight_guard" | "postflight_guard";
  chain: SkillRoleModelsMap[typeof roleKey];
  catalog: CatalogProvider[];
  palette: Palette;
  onSave: (role: PutRoleModelsRequest["role"], chain: PutRoleModelsRequest["chain"]) => Promise<void>;
}) {
  const [primary, setPrimary] = useState(chain[0]?.model ?? "");
  const [backup, setBackup] = useState(chain[1]?.model ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lockedReason = readOnlyReason(chain);
  const locked = lockedReason !== null;

  // Re-seed local state when the server chain changes (e.g. after a reload).
  // Skipped for the chain the state was already seeded from, so a selection
  // made before the mount effect runs is not wiped.
  const seededFrom = useRef(chain);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — seed from prop
  useEffect(() => {
    if (seededFrom.current === chain) return;
    seededFrom.current = chain;
    setPrimary(chain[0]?.model ?? "");
    setBackup(chain[1]?.model ?? "");
    setSaved(false);
  }, [chain]);

  async function save(chainEntries: PutRoleModelsRequest["chain"]) {
    // Never write over a chain Studio can't represent (also guards a
    // programmatic click on the disabled buttons).
    if (locked) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(roleKey, chainEntries);
      setSaved(true);
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setSaving(false);
    }
  }

  function buildChain(): PutRoleModelsRequest["chain"] {
    const out: PutRoleModelsRequest["chain"] = [];
    if (primary) out.push(guardEntry(primary));
    // Backup only makes sense when a primary is set.
    if (primary && backup) out.push(guardEntry(backup));
    return out;
  }

  const pinned = chain.length > 0;
  const statusText =
    chain.length === 0 ? "Inherits tenant default" : chain.map(entryLabel).join(" → ");

  return (
    <div data-testid={`role-row-${roleKey}`} style={{ borderTop: `1px solid var(--bb-border, #e2e8f0)`, paddingTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "inherit" }}>
          {label}
        </span>
        <span style={{ fontSize: "0.75rem", color: "inherit", opacity: 0.6 }}>{statusText}</span>
      </div>

      {error && (
        <div role="alert" style={{ fontSize: "0.8rem", marginBottom: "0.4rem" }}>
          {error}
        </div>
      )}

      {locked ? (
        <div role="note" data-testid={`${roleKey}-readonly`} style={{ fontSize: "0.78rem", margin: "0 0 0.5rem", opacity: 0.75 }}>
          {lockedReason}
        </div>
      ) : (
        <p style={{ fontSize: "0.78rem", margin: "0 0 0.4rem", opacity: 0.6 }}>{TENANT_DEFAULT_CAPTION}</p>
      )}

      <div style={{ display: "grid", gap: "0.4rem", marginBottom: "0.5rem" }}>
        <div>
          <label style={labelStyle()} for={`${roleKey}-primary`}>
            Primary model
          </label>
          <CatalogSelect
            id={`${roleKey}-primary`}
            value={primary}
            onChange={(v) => { setPrimary(v); setSaved(false); }}
            catalog={catalog}
            palette={p}
            disabled={saving || locked}
            placeholder="— tenant default —"
          />
        </div>
        <div>
          <label style={labelStyle()} for={`${roleKey}-backup`}>
            Backup model <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>
          </label>
          <CatalogSelect
            id={`${roleKey}-backup`}
            value={backup}
            onChange={(v) => { setBackup(v); setSaved(false); }}
            catalog={catalog}
            palette={p}
            disabled={saving || locked || !primary}
            placeholder="— no backup —"
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          disabled={saving || locked}
          onClick={() => void save(buildChain())}
          style={primaryBtn(p, saving || locked)}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving || locked || !pinned}
          onClick={() => {
            if (locked) return;
            setPrimary("");
            setBackup("");
            void save([]);
          }}
          style={ghostBtn(p)}
        >
          Inherit default
        </button>
        {saved && <span style={{ fontSize: "0.85rem", opacity: 0.8 }}>Saved ✓</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main-answer backup row — BACKUP only (primary = skill's main model).
// ---------------------------------------------------------------------------
function MainBackupRow({
  chain,
  catalog,
  palette: p,
  onSave,
}: {
  chain: SkillRoleModelsMap["main"];
  catalog: CatalogProvider[];
  palette: Palette;
  onSave: (role: PutRoleModelsRequest["role"], chain: PutRoleModelsRequest["chain"]) => Promise<void>;
}) {
  const [backup, setBackup] = useState(chain[0]?.model ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lockedReason = readOnlyReason(chain);
  const locked = lockedReason !== null;

  const seededFrom = useRef(chain);
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — seed from prop
  useEffect(() => {
    if (seededFrom.current === chain) return;
    seededFrom.current = chain;
    setBackup(chain[0]?.model ?? "");
    setSaved(false);
  }, [chain]);

  async function save(chainEntries: PutRoleModelsRequest["chain"]) {
    if (locked) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave("main", chainEntries);
      setSaved(true);
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setSaving(false);
    }
  }

  const hasBackup = chain.length > 0;
  const statusText = hasBackup ? `${chain.map(entryLabel).join(" → ")} · backup` : "No backup";

  return (
    <div data-testid="role-row-main" style={{ borderTop: `1px solid var(--bb-border, #e2e8f0)`, paddingTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Main answer backup
        </span>
        <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>{statusText}</span>
      </div>
      <p style={{ fontSize: "0.78rem", margin: "0 0 0.5rem", opacity: 0.6 }}>
        Your main model stays as configured above; this backup takes over only if the main fails.{" "}
        {TENANT_DEFAULT_CAPTION}
      </p>
      {locked && (
        <div role="note" data-testid="main-readonly" style={{ fontSize: "0.78rem", margin: "0 0 0.5rem", opacity: 0.75 }}>
          {lockedReason}
        </div>
      )}

      {error && (
        <div role="alert" style={{ fontSize: "0.8rem", marginBottom: "0.4rem" }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: "0.5rem" }}>
        <label style={labelStyle()} for="main-backup">
          Backup model <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span>
        </label>
        <CatalogSelect
          id="main-backup"
          value={backup}
          onChange={(v) => { setBackup(v); setSaved(false); }}
          catalog={catalog}
          palette={p}
          disabled={saving || locked}
          placeholder="— no backup —"
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          disabled={saving || locked || !backup}
          onClick={() => void save(backup ? [guardEntry(backup)] : [])}
          style={primaryBtn(p, saving || locked || !backup)}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving || locked || !hasBackup}
          onClick={() => {
            if (locked) return;
            setBackup("");
            void save([]);
          }}
          style={ghostBtn(p)}
        >
          Remove backup
        </button>
        {saved && <span style={{ fontSize: "0.85rem", opacity: 0.8 }}>Saved ✓</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public panel component — mounts inside EditableSkill (detail.tsx).
// ---------------------------------------------------------------------------
export function PerRoleModelPanel({
  api,
  palette: p,
  skillId,
  catalog,
  decisionSkill = false,
}: {
  api: SkillStudioApi;
  palette: Palette;
  skillId: string;
  /** Active model catalog — live from BFF when available, static fallback otherwise. */
  catalog: CatalogProvider[];
  /**
   * baobox#846 — a decision skill has no main chat call (BaoBox refuses a
   * `main` pin: 422 `decision_skill_no_main_pin`) and its postflight guard
   * never runs, so only the preflight guard row is shown.
   */
  decisionSkill?: boolean;
}) {
  const [roleModels, setRoleModels] = useState<SkillRoleModelsMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Derive a full map with safe empty-array defaults for every role so child
  // rows never have to handle `undefined`.
  const safeMap: SkillRoleModelsMap = {
    main: roleModels?.main ?? [],
    preflight_guard: roleModels?.preflight_guard ?? [],
    postflight_guard: roleModels?.postflight_guard ?? [],
    eval_judge: roleModels?.eval_judge ?? [],
  };

  async function load() {
    setLoadError(null);
    try {
      setRoleModels(await api.getRoleModels(skillId));
    } catch (err) {
      setLoadError(msgOf(err));
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is stable per (api, skillId)
  useEffect(() => {
    void load();
  }, [api, skillId]);

  async function handleSave(
    role: PutRoleModelsRequest["role"],
    chain: PutRoleModelsRequest["chain"],
  ): Promise<void> {
    await api.putRoleModels(skillId, { role, chain });
    // Reload the full map so every row reflects the server's canonical state.
    await load();
  }

  return (
    <section>
      <h3 style={sectionTitle()}>Per-role models &amp; fallback</h3>
      <p style={{ fontSize: "0.8rem", margin: "0 0 0.5rem", opacity: 0.65 }}>
        Run a cheaper or faster model for a guard, and add a backup that takes over if a model
        fails. Leave a role on "tenant default" to inherit the skill's model.
      </p>

      {loadError && (
        <div role="alert" style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
          {loadError}
        </div>
      )}

      {roleModels === null && !loadError ? (
        <div style={{ ...cardStyle(p), color: "inherit", opacity: 0.6, fontSize: "0.85rem" }}>
          Loading…
        </div>
      ) : (
        <div style={{ ...cardStyle(p), display: "grid", gap: "0.75rem" }}>
          {decisionSkill && (
            <p role="note" style={{ fontSize: "0.78rem", margin: 0, opacity: 0.65 }}>
              A decision skill has no main model call and its postflight guard never runs, so
              only the preflight guard is configurable.
            </p>
          )}
          {GUARD_ROLES.filter((r) => !decisionSkill || r.key === "preflight_guard").map((r) => (
            <GuardRoleRow
              key={r.key}
              label={r.label}
              roleKey={r.key}
              chain={safeMap[r.key]}
              catalog={catalog}
              palette={p}
              onSave={handleSave}
            />
          ))}
          {!decisionSkill && (
            <MainBackupRow
              chain={safeMap.main}
              catalog={catalog}
              palette={p}
              onSave={handleSave}
            />
          )}
        </div>
      )}
    </section>
  );
}

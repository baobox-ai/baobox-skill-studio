// ---------------------------------------------------------------------------
// Per-role models & fallback panel (#328).
//
// Mirrors the BaoBox tenant portal's "Per-role models & fallback" card, adapted
// to the Studio's Preact / web-component stack and catalog-only model picker
// (no off-box integration list — see scope decision in #328).
//
// Coverage:
//   preflight_guard  — PRIMARY model + optional BACKUP
//   postflight_guard — PRIMARY model + optional BACKUP
//   main             — BACKUP only (its primary is the skill's main model)
//
// Each save does a PUT /skills/:id/role-models with { role, chain } where chain
// is the non-empty slots in order as
//   { llmIntegrationId: null, model, llmSource: "pinned" }.
// An empty selection means "clear / inherit tenant default" (chain = []).
// ---------------------------------------------------------------------------

import { useEffect, useState } from "preact/hooks";
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

// Build a chain entry for a pinned catalog model. llmIntegrationId is always
// null in Studio scope (no off-box integration picker — #328 scope decision).
function pinnedEntry(model: string): PutRoleModelsRequest["chain"][number] {
  return { llmIntegrationId: null, model, llmSource: "pinned" };
}

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

  // Re-seed local state when the server chain changes (e.g. after a reload).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — seed from prop
  useEffect(() => {
    setPrimary(chain[0]?.model ?? "");
    setBackup(chain[1]?.model ?? "");
    setSaved(false);
  }, [chain]);

  async function save(chainEntries: PutRoleModelsRequest["chain"]) {
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
    if (primary) out.push(pinnedEntry(primary));
    // Backup only makes sense when a primary is pinned.
    if (primary && backup) out.push(pinnedEntry(backup));
    return out;
  }

  const pinned = chain.length > 0;
  const statusText =
    chain.length === 0
      ? "Inherits tenant default"
      : `${chain[0]?.model ?? ""} · pinned${chain.length > 1 ? ` → ${chain[1]?.model ?? "backup"}` : ""}`;

  return (
    <div style={{ borderTop: `1px solid var(--bb-border, #e2e8f0)`, paddingTop: "0.75rem" }}>
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
            disabled={saving}
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
            disabled={saving || !primary}
            placeholder="— no backup —"
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(buildChain())}
          style={primaryBtn(p, saving)}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving || !pinned}
          onClick={() => {
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — seed from prop
  useEffect(() => {
    setBackup(chain[0]?.model ?? "");
    setSaved(false);
  }, [chain]);

  async function save(chainEntries: PutRoleModelsRequest["chain"]) {
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
  const statusText = hasBackup ? `${chain[0]?.model ?? ""} · backup` : "No backup";

  return (
    <div style={{ borderTop: `1px solid var(--bb-border, #e2e8f0)`, paddingTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Main answer backup
        </span>
        <span style={{ fontSize: "0.75rem", opacity: 0.6 }}>{statusText}</span>
      </div>
      <p style={{ fontSize: "0.78rem", margin: "0 0 0.5rem", opacity: 0.6 }}>
        Your main model stays as configured above; this backup takes over only if the main fails.
      </p>

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
          disabled={saving}
          placeholder="— no backup —"
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          type="button"
          disabled={saving || !backup}
          onClick={() => void save(backup ? [pinnedEntry(backup)] : [])}
          style={primaryBtn(p, saving || !backup)}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving || !hasBackup}
          onClick={() => {
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
}: {
  api: SkillStudioApi;
  palette: Palette;
  skillId: string;
  /** Active model catalog — live from BFF when available, static fallback otherwise. */
  catalog: CatalogProvider[];
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
          {GUARD_ROLES.map((r) => (
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
          <MainBackupRow
            chain={safeMap.main}
            catalog={catalog}
            palette={p}
            onSave={handleSave}
          />
        </div>
      )}
    </section>
  );
}

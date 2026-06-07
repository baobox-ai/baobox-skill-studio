import { useEffect, useRef, useState } from "preact/hooks";
import type {
  SkillDetail,
  SkillParameter,
  SkillStructuralUpdateRequest,
  SkillStudioApi,
  SkillSummary,
  SkillToolSummary,
} from "./api.js";
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
};

function toDraft(d: SkillDetail): EditDraft {
  return {
    name: d.name,
    description: d.description,
    systemPrompt: d.systemPrompt,
    model: d.model,
    temperature: String(d.temperature),
    maxTokens: String(d.maxTokens),
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

  function set<K extends keyof EditDraft>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  // Diff the draft against the loaded detail; only changed fields are sent.
  function changedFields(): SkillStructuralUpdateRequest {
    const out: SkillStructuralUpdateRequest = {};
    if (draft.name !== detail.name) out.name = draft.name;
    if (draft.description !== detail.description) out.description = draft.description;
    if (draft.systemPrompt !== detail.systemPrompt) out.systemPrompt = draft.systemPrompt;
    if (draft.model !== detail.model) out.model = draft.model;
    const t = Number(draft.temperature);
    if (draft.temperature.trim() !== "" && t !== detail.temperature) out.temperature = t;
    const m = Number(draft.maxTokens);
    if (draft.maxTokens.trim() !== "" && m !== detail.maxTokens) out.maxTokens = m;
    return out;
  }

  const dirty = Object.keys(changedFields()).length > 0;

  async function save() {
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

      <div style={{ display: "flex", gap: "0.75rem" }}>
        <div style={{ flex: 2 }}>
          <label style={labelStyle()} for="bb-model">
            Model
          </label>
          <input
            id="bb-model"
            aria-label="Model"
            value={draft.model}
            onInput={(e) => set("model", (e.currentTarget as HTMLInputElement).value)}
            style={inputStyle(p)}
          />
        </div>
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
            value={draft.temperature}
            onInput={(e) => set("temperature", (e.currentTarget as HTMLInputElement).value)}
            style={inputStyle(p)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle()} for="bb-max">
            Max tokens
          </label>
          <input
            id="bb-max"
            aria-label="Max tokens"
            type="number"
            min="1"
            value={draft.maxTokens}
            onInput={(e) => set("maxTokens", (e.currentTarget as HTMLInputElement).value)}
            style={inputStyle(p)}
          />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.6rem" }}>
        <button type="button" disabled={!dirty || saving} onClick={() => void save()} style={primaryBtn(p, !dirty || saving)}>
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && !dirty && <span style={{ color: p.success, fontSize: "0.85rem" }}>Saved ✓</span>}
      </div>

      <SubSkillsPanel api={api} palette={p} skillId={detail.id} />
      <ToolsPanel api={api} palette={p} skillId={detail.id} />
      <ParametersPanel api={api} palette={p} skillId={detail.id} />
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
// surfaced here. (The contract has no allowlist-enumeration endpoint, so the
// picker is attach-by-id; the server is the authority on what's permitted.)
// ---------------------------------------------------------------------------
function ToolsPanel({ api, palette: p, skillId }: { api: SkillStudioApi; palette: Palette; skillId: string }) {
  const [tools, setTools] = useState<SkillToolSummary[] | null>(null);
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

  async function attach() {
    const id = toolId.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await api.attachTool(skillId, id);
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
        <input
          aria-label="Tool id to attach"
          placeholder="Tool id (e.g. tl_…)"
          value={toolId}
          onInput={(e) => setToolId((e.currentTarget as HTMLInputElement).value)}
          style={{ ...inputStyle(p), flex: 1 }}
        />
        <button type="button" disabled={!toolId.trim() || busy} onClick={() => void attach()} style={ghostBtn(p)}>
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
type ParamRow = SkillParameter & { _id: number };

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

  // Re-seed rows from a server list, assigning stable local ids.
  function seedRows(params: SkillParameter[]) {
    setRows(params.map((param, i) => ({ ...param, _id: i })));
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

  function update(id: number, patch: Partial<SkillParameter>) {
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
      const payload: SkillParameter[] = rows.map(({ _id, ...param }) => param);
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
        Per-tenant values injected without editing the prompt. Secret values are hidden — re-enter one to change it.
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
                placeholder={r.secret ? "•••• (hidden)" : "value"}
                type={r.secret ? "password" : "text"}
                value={r.value}
                onInput={(e) => update(r._id, { value: (e.currentTarget as HTMLInputElement).value })}
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

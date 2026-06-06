import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  createApi,
  type SkillDetail,
  type SkillStudioApi,
  SkillStudioApiError,
  type SkillSummary,
} from "./api.js";

export interface SkillStudioProps {
  /** Base URL of the tenant BFF (e.g. "/api/skill-studio"). Required. */
  apiBase: string;
  /** Visual theme. Default "light". */
  theme?: "light" | "dark";
  /** Inject an API client (tests / advanced hosts). Defaults to `createApi(apiBase)`. */
  api?: SkillStudioApi;
}

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  card: string;
}

const PALETTES: Record<"light" | "dark", Palette> = {
  light: { bg: "#ffffff", fg: "#0f172a", muted: "#64748b", border: "#e2e8f0", accent: "#4f46e5", card: "#f8fafc" },
  dark: { bg: "#0f172a", fg: "#e2e8f0", muted: "#94a3b8", border: "#1e293b", accent: "#818cf8", card: "#1e293b" },
};

function msgOf(err: unknown): string {
  if (err instanceof SkillStudioApiError) return `${err.message} (${err.code})`;
  return err instanceof Error ? err.message : "Something went wrong";
}

export function SkillStudio({ apiBase, theme = "light", api: injectedApi }: SkillStudioProps) {
  // Refuse to construct a client without a base — createApi would throw, and we
  // must never silently fall back to the embedding origin (could be BaoBox).
  const api = useMemo<SkillStudioApi | null>(
    () => injectedApi ?? (apiBase ? createApi(apiBase) : null),
    [injectedApi, apiBase],
  );
  const p = PALETTES[theme] ?? PALETTES.light;
  const wrap = {
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    color: p.fg,
    background: p.bg,
    padding: "1rem",
    borderRadius: "8px",
  };

  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // Load (and reload) the list with a stale-response guard so a slow response
  // can't set state after unmount or after `apiBase`/reload changes.
  useEffect(() => {
    if (!api) return;
    let live = true;
    setListError(null);
    setSkills(null);
    api
      .listSkills()
      .then((s) => live && setSkills(s))
      .catch((err) => live && setListError(msgOf(err)));
    return () => {
      live = false;
    };
  }, [api, reloadKey]);

  if (!api) {
    return (
      <div style={{ ...wrap, color: "#b91c1c" }} role="alert">
        <strong>&lt;baobox-skill-builder&gt;</strong>: the <code>api-base</code> attribute is
        required (point it at your tenant BFF).
      </div>
    );
  }

  if (selectedId) {
    return (
      <div style={wrap}>
        <SkillDetailView
          api={api}
          palette={p}
          skillId={selectedId}
          onBack={() => {
            setSelectedId(null);
            reload();
          }}
        />
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Skills</h2>
        <span style={{ color: p.muted, fontSize: "0.85rem" }}>{skills ? `${skills.length} configured` : ""}</span>
      </div>

      {listError && (
        <div role="alert" style={{ color: "#b91c1c", marginBottom: "0.5rem" }}>
          {listError}{" "}
          <button type="button" onClick={reload} style={linkBtn(p)}>
            Retry
          </button>
        </div>
      )}

      {!skills && !listError && <p style={{ color: p.muted }}>Loading…</p>}

      {skills && skills.length === 0 && <p style={{ color: p.muted }}>No skills yet.</p>}

      {skills && skills.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
          {skills.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSelectedId(s.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  background: p.card,
                  border: `1px solid ${p.border}`,
                  borderRadius: "6px",
                  padding: "0.6rem 0.75rem",
                  color: p.fg,
                }}
              >
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ color: p.muted, fontSize: "0.8rem" }}>
                  {s.id} · {s.model}
                  {s.tenantId === null ? " · global" : ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SkillDetailView({
  api,
  palette: p,
  skillId,
  onBack,
}: {
  api: SkillStudioApi;
  palette: Palette;
  skillId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    setError(null);
    setDetail(null);
    api
      .getSkill(skillId)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setDraft(d.description);
      })
      .catch((err) => live && setError(msgOf(err)));
    return () => {
      live = false;
    };
  }, [api, skillId]);

  const dirty = detail !== null && draft !== detail.description;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Phase 1 is a single-field edit: send only `description`.
      const updated = await api.updateSkill(skillId, { description: draft });
      setDetail(updated);
      setDraft(updated.description);
      setSaved(true);
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={onBack} style={linkBtn(p)}>
        ← Back to skills
      </button>

      {error && (
        <div role="alert" style={{ color: "#b91c1c", margin: "0.5rem 0" }}>
          {error}
        </div>
      )}
      {!detail && !error && <p style={{ color: p.muted }}>Loading…</p>}

      {detail && (
        <div style={{ marginTop: "0.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0 0 0.25rem" }}>{detail.name}</h2>
          <div style={{ color: p.muted, fontSize: "0.8rem", marginBottom: "0.75rem" }}>
            {detail.id} · {detail.model}
          </div>

          <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            Description
          </label>
          <textarea
            aria-label="Description"
            value={draft}
            onInput={(e) => {
              setDraft((e.currentTarget as HTMLTextAreaElement).value);
              setSaved(false);
            }}
            rows={3}
            style={{
              width: "100%",
              boxSizing: "border-box",
              borderRadius: "6px",
              border: `1px solid ${p.border}`,
              padding: "0.5rem",
              background: p.bg,
              color: p.fg,
              fontFamily: "inherit",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.5rem" }}>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void save()}
              style={{
                background: !dirty || saving ? p.muted : p.accent,
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "0.45rem 0.9rem",
                cursor: !dirty || saving ? "default" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && !dirty && <span style={{ color: "#15803d", fontSize: "0.85rem" }}>Saved ✓</span>}
          </div>

          <details style={{ marginTop: "1rem" }}>
            <summary style={{ cursor: "pointer", color: p.muted }}>System prompt (read-only)</summary>
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
      )}
    </div>
  );
}

function linkBtn(p: Palette) {
  return {
    background: "none",
    border: "none",
    color: p.accent,
    cursor: "pointer",
    padding: 0,
    font: "inherit",
  };
}

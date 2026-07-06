import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  createApi,
  type SkillCreateRequest,
  type SkillStudioApi,
  type SkillSummary,
} from "./api.js";
import { SkillDetailView } from "./detail.js";
import { IncomingDrafts } from "./drafts.js";
import { resolvePalette, THEME_STYLE, type ThemeName } from "./theme.js";
import { ghostBtn, inputStyle, labelStyle, linkBtn, msgOf, primaryBtn } from "./ui.js";

export interface SkillStudioProps {
  /** Base URL of the tenant BFF (e.g. "/api/skill-studio"). Required. */
  apiBase: string;
  /** Visual theme. Default "light". Host pages can also override the `--bb-*` CSS custom properties. */
  theme?: ThemeName;
  /** Inject an API client (tests / advanced hosts). Defaults to `createApi(apiBase)`. */
  api?: SkillStudioApi;
}

type View = { kind: "list" } | { kind: "create" } | { kind: "detail"; id: string } | { kind: "drafts" };

// Top-level navigation tabs.
type Tab = "skills" | "drafts";

export function SkillStudio({ apiBase, theme = "light", api: injectedApi }: SkillStudioProps) {
  // Refuse to construct a client without a base — createApi would throw, and we
  // must never silently fall back to the embedding origin (could be BaoBox).
  const api = useMemo<SkillStudioApi | null>(
    () => injectedApi ?? (apiBase ? createApi(apiBase) : null),
    [injectedApi, apiBase],
  );
  const p = resolvePalette(theme);
  const wrap = {
    fontFamily: p.font,
    color: p.fg,
    background: p.bg,
    padding: "1rem",
    borderRadius: p.radius,
  };

  const [view, setView] = useState<View>({ kind: "list" });
  const [tab, setTab] = useState<Tab>("skills");

  // When switching tabs, reset the skills view to the list.
  function switchTab(t: Tab) {
    setTab(t);
    if (t === "skills") setView({ kind: "list" });
  }

  if (!api) {
    return (
      <div style={{ ...wrap, color: p.danger }} role="alert">
        {/* THEME_STYLE is harmless in light DOM (its :host rules are inert). */}
        <style>{THEME_STYLE}</style>
        <strong>&lt;baobox-skill-builder&gt;</strong>: the <code>api-base</code> attribute is
        required (point it at your tenant BFF).
      </div>
    );
  }

  return (
    <div style={wrap}>
      <style>{THEME_STYLE}</style>

      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: "0",
          borderBottom: `2px solid ${p.border}`,
          marginBottom: "1rem",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "skills"}
          onClick={() => switchTab("skills")}
          style={{
            background: "none",
            border: "none",
            borderBottom: tab === "skills" ? `2px solid ${p.accent}` : "2px solid transparent",
            marginBottom: "-2px",
            padding: "0.4rem 0.9rem",
            fontWeight: tab === "skills" ? 600 : 400,
            color: tab === "skills" ? p.accent : p.fg,
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.9rem",
          }}
        >
          Skills
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "drafts"}
          onClick={() => switchTab("drafts")}
          style={{
            background: "none",
            border: "none",
            borderBottom: tab === "drafts" ? `2px solid ${p.accent}` : "2px solid transparent",
            marginBottom: "-2px",
            padding: "0.4rem 0.9rem",
            fontWeight: tab === "drafts" ? 600 : 400,
            color: tab === "drafts" ? p.accent : p.fg,
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.9rem",
          }}
        >
          Incoming drafts
        </button>
      </div>

      {tab === "drafts" && <IncomingDrafts api={api} palette={p} />}

      {tab === "skills" && view.kind === "detail" && (
        <SkillDetailView
          api={api}
          palette={p}
          skillId={view.id}
          onBack={() => setView({ kind: "list" })}
          onOpen={(id) => setView({ kind: "detail", id })}
        />
      )}
      {tab === "skills" && view.kind === "create" && (
        <CreateSkillWizard
          api={api}
          palette={p}
          onCancel={() => setView({ kind: "list" })}
          onCreated={(id) => setView({ kind: "detail", id })}
        />
      )}
      {tab === "skills" && view.kind === "list" && (
        <SkillList
          api={api}
          palette={p}
          onOpen={(id) => setView({ kind: "detail", id })}
          onNew={() => setView({ kind: "create" })}
        />
      )}
    </div>
  );
}

function SkillList({
  api,
  palette: p,
  onOpen,
  onNew,
}: {
  api: SkillStudioApi;
  palette: ReturnType<typeof resolvePalette>;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Skills</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ color: p.muted, fontSize: "0.85rem" }}>{skills ? `${skills.length} configured` : ""}</span>
          <button type="button" onClick={onNew} style={primaryBtn(p)}>
            + New skill
          </button>
        </div>
      </div>

      {listError && (
        <div role="alert" style={{ color: p.danger, marginBottom: "0.5rem" }}>
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
                onClick={() => onOpen(s.id)}
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

function CreateSkillWizard({
  api,
  palette: p,
  onCancel,
  onCreated,
}: {
  api: SkillStudioApi;
  palette: ReturnType<typeof resolvePalette>;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0 && systemPrompt.trim().length > 0;

  async function create() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const req: SkillCreateRequest = {
        name: name.trim(),
        systemPrompt,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      };
      const created = await api.createSkill(req);
      onCreated(created.id);
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={onCancel} style={linkBtn(p)}>
        ← Back to skills
      </button>
      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: "0.5rem 0" }}>New skill</h2>

      {error && (
        <div role="alert" style={{ color: p.danger, margin: "0.5rem 0" }}>
          {error}
        </div>
      )}

      <label style={labelStyle()} for="bb-new-name">
        Name
      </label>
      <input
        id="bb-new-name"
        aria-label="Name"
        value={name}
        onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        style={inputStyle(p)}
      />

      <label style={labelStyle()} for="bb-new-desc">
        Description
      </label>
      <textarea
        id="bb-new-desc"
        aria-label="Description"
        value={description}
        rows={2}
        onInput={(e) => setDescription((e.currentTarget as HTMLTextAreaElement).value)}
        style={inputStyle(p)}
      />

      <label style={labelStyle()} for="bb-new-prompt">
        System prompt
      </label>
      <textarea
        id="bb-new-prompt"
        aria-label="System prompt"
        value={systemPrompt}
        rows={5}
        onInput={(e) => setSystemPrompt((e.currentTarget as HTMLTextAreaElement).value)}
        style={inputStyle(p)}
      />

      <label style={labelStyle()} for="bb-new-model">
        Model <span style={{ color: p.muted, fontWeight: 400 }}>(optional)</span>
      </label>
      <input
        id="bb-new-model"
        aria-label="Model"
        value={model}
        onInput={(e) => setModel((e.currentTarget as HTMLInputElement).value)}
        style={inputStyle(p)}
      />

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
        <button type="button" disabled={!valid || busy} onClick={() => void create()} style={primaryBtn(p, !valid || busy)}>
          {busy ? "Creating…" : "Create skill"}
        </button>
        <button type="button" onClick={onCancel} style={ghostBtn(p)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

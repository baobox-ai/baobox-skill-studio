// ED-2 (#433) — Incoming skill drafts surface (External Dreamer, review-gated).
//
// Lists pending drafts from the BFF GET /drafts endpoint. Each row shows:
//   skill name, version label, source, submitted_at, provenance session ids
//   (copyable plain text — no deep links), and an Approve button.
//
// Approve is the ONLY action (no bulk, no reject — out of scope for ED-2).
// The Approve button opens a confirm dialog before POSTing to the BFF.
import { useCallback, useEffect, useState } from "preact/hooks";
import type { SkillDraft, SkillStudioApi } from "./api.js";
import type { Palette } from "./theme.js";
import { cardStyle, ghostBtn, linkBtn, msgOf, primaryBtn, sectionTitle } from "./ui.js";

interface IncomingDraftsProps {
  api: SkillStudioApi;
  palette: Palette;
}

export function IncomingDrafts({ api, palette: p }: IncomingDraftsProps) {
  const [drafts, setDrafts] = useState<SkillDraft[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let live = true;
    setLoadError(null);
    setDrafts(null);
    api
      .listDrafts()
      .then((d) => live && setDrafts(d))
      .catch((err) => live && setLoadError(msgOf(err)));
    return () => {
      live = false;
    };
  }, [api, reloadKey]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.75rem",
        }}
      >
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Incoming drafts</h2>
        <button type="button" onClick={reload} style={ghostBtn(p)}>
          Refresh
        </button>
      </div>

      {loadError && (
        <div role="alert" style={{ color: p.danger, marginBottom: "0.5rem" }}>
          {loadError}{" "}
          <button type="button" onClick={reload} style={linkBtn(p)}>
            Retry
          </button>
        </div>
      )}

      {!drafts && !loadError && <p style={{ color: p.muted }}>Loading…</p>}

      {drafts && drafts.length === 0 && (
        <p style={{ color: p.muted, fontSize: "0.9rem" }}>No pending drafts.</p>
      )}

      {drafts && drafts.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
          {drafts.map((draft) => (
            <li key={draft.version_id}>
              <DraftRow draft={draft} api={api} palette={p} onApproved={reload} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DraftRow({
  draft,
  api,
  palette: p,
  onApproved,
}: {
  draft: SkillDraft;
  api: SkillStudioApi;
  palette: Palette;
  onApproved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      await api.approveDraft(draft.version_id);
      setConfirming(false);
      onApproved();
    } catch (err) {
      setError(msgOf(err));
    } finally {
      setApproving(false);
    }
  }

  const submittedAt = formatDate(draft.submitted_at);

  return (
    <div style={{ ...cardStyle(p), display: "grid", gap: "0.4rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.5rem",
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>{draft.skill_name}</div>
          <div style={{ color: p.muted, fontSize: "0.8rem" }}>
            {draft.version_label} · {draft.source} · {submittedAt}
          </div>
        </div>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            style={primaryBtn(p)}
            aria-label={`Approve draft ${draft.version_label}`}
          >
            Approve
          </button>
        )}
      </div>

      {/* Provenance session ids — copyable text, no deep links (ED-2 scope) */}
      {draft.provenance.length > 0 && (
        <div>
          <h3 style={{ ...sectionTitle(), margin: "0.25rem 0 0.2rem", fontSize: "0.8rem" }}>
            Provenance
          </h3>
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
              color: p.muted,
              wordBreak: "break-all",
            }}
          >
            {draft.provenance.join(", ")}
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirming && (
        <div
          role="dialog"
          aria-label={`Confirm approval of ${draft.version_label}`}
          style={{
            background: p.card,
            border: `1px solid ${p.border}`,
            borderRadius: "6px",
            padding: "0.6rem 0.75rem",
            marginTop: "0.25rem",
          }}
        >
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
            Approve <strong>{draft.version_label}</strong> for{" "}
            <strong>{draft.skill_name}</strong>? This will promote the draft to active.
          </p>
          {error && (
            <div role="alert" style={{ color: p.danger, fontSize: "0.85rem", marginBottom: "0.4rem" }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              disabled={approving}
              onClick={() => void approve()}
              style={primaryBtn(p, approving)}
            >
              {approving ? "Approving…" : "Confirm approve"}
            </button>
            <button
              type="button"
              disabled={approving}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              style={ghostBtn(p)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

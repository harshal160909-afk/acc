"use client";

import { useEffect, useState } from "react";
import { formatDisplayDate } from "../lib/finance";
import type { PostedEntry, WorkspaceConfig } from "./types";

type ProviderStatus = {
  provider: "openai" | "nvidia";
  configured: boolean;
  model: string | null;
  status: "available" | "configuration_required" | "temporarily_unavailable";
  message: string;
};

type ServiceStatus = {
  ai: { defaultProvider: string; fallbackProvider: string | null; providers: ProviderStatus[] };
  marketData: { configured: boolean; provider: string | null; status: string; message: string };
  contact: { phone: string | null; whatsapp: string | null; email: string | null; instagram: string | null };
  checkedAt: number;
};

export function SettingsView({ config, entries, signOutPath, onEditProfile }: {
  config: WorkspaceConfig;
  entries: PostedEntry[];
  signOutPath: string;
  onEditProfile: (openingBalancesLocked: boolean) => void;
}) {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [support, setSupport] = useState({ topic: "Product support", message: "" });
  const [supportState, setSupportState] = useState<"idle" | "sending" | "sent">("idle");
  const [supportError, setSupportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteState, setDeleteState] = useState<"idle" | "deleting">("idle");
  const [privacyError, setPrivacyError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const body = await response.json() as ServiceStatus & { error?: string };
        if (!response.ok) throw new Error(body.error || "Service status is unavailable.");
        setStatus(body);
      } catch (cause) {
        setStatusError(cause instanceof Error ? cause.message : "Service status is unavailable.");
      }
    })();
  }, []);

  async function exportWorkspace() {
    setExporting(true); setPrivacyError("");
    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error || "Your export could not be prepared.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ACC-${config.businessName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace"}-complete-export.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (cause) {
      setPrivacyError(cause instanceof Error ? cause.message : "Your export could not be prepared.");
    } finally { setExporting(false); }
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "DELETE ACC DATA" || deleteState === "deleting") return;
    setDeleteState("deleting"); setPrivacyError("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Account deletion did not complete.");
      window.location.assign("/");
    } catch (cause) {
      setDeleteState("idle");
      setPrivacyError(cause instanceof Error ? cause.message : "Account deletion did not complete.");
    }
  }

  async function submitSupport(event: React.FormEvent) {
    event.preventDefault(); setSupportState("sending"); setSupportError("");
    try {
      const response = await fetch("/api/support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(support) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Support request could not be saved.");
      setSupportState("sent"); setSupport({ ...support, message: "" });
    } catch (cause) {
      setSupportState("idle"); setSupportError(cause instanceof Error ? cause.message : "Support request could not be saved.");
    }
  }

  return <div className="settings-view">
    <header className="view-heading"><div><span>SETTINGS</span><h1>Your workspace, providers, and privacy.</h1><p>Review what is connected. Secrets remain in server-side hosting configuration and never appear here.</p></div></header>
    <div className="settings-grid">
      <section className="settings-card glass-panel"><header><span>BUSINESS PROFILE</span><strong>{config.businessName}</strong></header><dl><div><dt>Owner</dt><dd>{config.ownerName}</dd></div><div><dt>Signed-in account</dt><dd>{config.email}</dd></div><div><dt>Financial year</dt><dd>{config.financialYear}</dd></div><div><dt>Book entries</dt><dd>{entries.length}</dd></div><div><dt>Last workspace update</dt><dd>{config.updatedAt ? formatDisplayDate(new Date(config.updatedAt).toISOString().slice(0, 10)) : "Setup record"}</dd></div></dl><footer><button className="button button-secondary" onClick={() => onEditProfile(entries.length > 0)}>Edit business profile</button><a className="button button-quiet" href={signOutPath}>Sign out</a></footer></section>
      <section className="settings-card glass-panel"><header><span>AI PROVIDERS</span><strong>Server-side only</strong></header>{status ? <div className="provider-list">{status.ai.providers.map((provider) => <article key={provider.provider}><i className={provider.status} /><div><strong>{provider.provider === "openai" ? "OpenAI" : "NVIDIA"}{provider.provider === status.ai.defaultProvider ? " · Primary" : provider.provider === status.ai.fallbackProvider ? " · Fallback" : ""}</strong><span>{provider.model ?? "Model not configured"}</span><small>{provider.message}</small></div></article>)}</div> : <p>{statusError || "Checking provider configuration…"}</p>}<footer><p>Configure <code>OPENAI_API_KEY</code> with <code>OPENAI_MODEL</code>, or the NVIDIA equivalents, in the hosting secret manager. Never paste a secret into a chat or browser form.</p></footer></section>
      <section className="settings-card glass-panel"><header><span>MARKET DATA</span><strong>{status?.marketData.configured ? status.marketData.provider || "Configured provider" : "Manual prices only"}</strong></header><p>{status?.marketData.message ?? (statusError || "Checking market data configuration…")}</p><div className="status-band"><i className={status?.marketData.configured ? "available" : "configuration_required"} /><span>{status?.marketData.configured ? "Licensed source configured" : "Configuration required for external quotes and news"}</span></div><footer><p>Until a licensed source is configured, ACC leaves prices and news unavailable. User-entered prices remain clearly labelled with their timestamp.</p></footer></section>
      <section className="settings-card glass-panel"><header><span>YOUR DATA</span><strong>Portable and under your control</strong></header><p>Download a complete owner-scoped JSON export, including posted books, audit records, portfolios, conversations, and Market Research records.</p><button className="button button-secondary" onClick={() => void exportWorkspace()} disabled={exporting}>{exporting ? "Preparing complete export…" : "Download complete ACC export"}</button><footer><p>Exporting is read-only. It does not change or remove your records.</p></footer></section>
      <section className="settings-card glass-panel danger-card"><header><span>DELETE ACCOUNT</span><strong>Permanent and irreversible</strong></header><p>This removes your ACC user, sessions, businesses, books, portfolios, AI history, and market-research records in one atomic operation.</p><label>Type <strong>DELETE ACC DATA</strong> to confirm<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" /></label><button className="button button-danger" disabled={deleteConfirmation !== "DELETE ACC DATA" || deleteState === "deleting"} onClick={() => void deleteAccount()}>{deleteState === "deleting" ? "Deleting account…" : "Permanently delete my ACC account"}</button>{privacyError ? <p className="modal-error" role="alert">{privacyError}</p> : null}<footer><p>ACC will not accept a partial deletion as success. If the operation fails, your account remains available for retry.</p></footer></section>
    </div>
    <section className="support-section glass-panel"><div><span>CONTACT & SUPPORT</span><h2>Tell us what is not working.</h2><p>Your request is saved with the signed-in workspace so it can be followed up safely.</p>{status?.contact.phone || status?.contact.whatsapp || status?.contact.email || status?.contact.instagram ? <div className="contact-links">{status.contact.phone ? <a href={`tel:${status.contact.phone}`}>Call {status.contact.phone}</a> : null}{status.contact.whatsapp ? <a href={`https://wa.me/${status.contact.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a> : null}{status.contact.email ? <a href={`mailto:${status.contact.email}`}>Email</a> : null}{status.contact.instagram ? <a href={`https://instagram.com/${status.contact.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer">Instagram</a> : null}</div> : <p className="config-note">Direct contact details have not been configured yet. The support form still records your request.</p>}</div><form onSubmit={(event) => void submitSupport(event)}><label>Topic<select value={support.topic} onChange={(event) => setSupport({ ...support, topic: event.target.value })}><option>Product support</option><option>Accounting record issue</option><option>AI provider issue</option><option>Market data issue</option><option>Data export</option><option>Data deletion</option></select></label><label>Message<textarea rows={5} maxLength={2000} required value={support.message} onChange={(event) => setSupport({ ...support, message: event.target.value })} placeholder="Describe what happened and what you expected." /></label>{supportError ? <p className="modal-error" role="alert">{supportError}</p> : null}{supportState === "sent" ? <p className="support-success" role="status">Request received. Your records were not changed.</p> : null}<button className="button button-primary" type="submit" disabled={supportState === "sending"}>{supportState === "sending" ? "Sending…" : "Send support request"}</button></form></section>
  </div>;
}

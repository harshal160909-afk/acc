"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DataUnavailableState } from "./FinancialUI";
import { openAccSession, signOutAcc } from "../lib/client/session";
import { OnboardingFlow } from "./OnboardingFlow";
import type { BusinessType, LegalStructure, WorkspaceConfig } from "./types";
import { Workspace } from "./Workspace";

type InitialIdentity = {
  displayName: string;
  accessMode: "guest" | "google";
  optionalContactEmail: string | null;
};

type Props = {
  // Present when this browser already holds a valid session (returning visitor).
  // Null for a first-time visitor, who sees the landing and one "Open ACC" step.
  initialIdentity: InitialIdentity | null;
};

type BootstrapState =
  | { status: "landing" }
  | { status: "loading" }
  | { status: "onboarding"; profile?: WorkspaceConfig }
  | { status: "ready"; profile: WorkspaceConfig }
  | { status: "error"; message: string };

const BUSINESS_TYPES = new Set<BusinessType>(["freelancer", "retail", "service", "ecommerce", "agency", "manufacturing", "nonprofit", "personal", "other"]);
const LEGAL_STRUCTURES = new Set<LegalStructure>(["not_specified", "sole", "partnership", "private"]);

export function AccLogo({ compact = false }: { compact?: boolean }) {
  return <div className={`acc-wordmark${compact ? " compact" : ""}`} aria-label="ACC"><span aria-hidden="true">A</span><strong>ACC</strong></div>;
}

function isProfile(value: unknown): value is WorkspaceConfig {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.ownerName === "string"
    && typeof row.email === "string"
    && typeof row.businessName === "string"
    && BUSINESS_TYPES.has(row.businessType as BusinessType)
    && typeof row.customBusinessType === "string"
    && LEGAL_STRUCTURES.has(row.legalStructure as LegalStructure)
    && Number.isSafeInteger(row.openingBankPaise)
    && Number(row.openingBankPaise) >= 0
    && Number.isSafeInteger(row.cashInHandPaise)
    && Number(row.cashInHandPaise) >= 0
    && Number.isSafeInteger(row.openingCapitalPaise)
    && Number(row.openingCapitalPaise) >= 0
    && Number.isSafeInteger(Number(row.openingBankPaise) + Number(row.cashInHandPaise) + Number(row.openingCapitalPaise))
    && row.connectionMode === "manual"
    && typeof row.financialYear === "string";
}

export function AccApp({ initialIdentity }: Props) {
  const [bootstrap, setBootstrap] = useState<BootstrapState>(
    initialIdentity ? { status: "loading" } : { status: "landing" },
  );
  const [editing, setEditing] = useState<{ openingBalancesLocked: boolean } | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const loadProfile = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      try {
        response = await fetch("/api/profile", { cache: "no-store", signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
      const body = await response.json() as { profile?: unknown; error?: string };
      if (!mounted.current) return;
      if (!response.ok) throw new Error(body.error || "We could not load your workspace profile.");
      if (body.profile === null || body.profile === undefined) {
        setBootstrap({ status: "onboarding" });
        return;
      }
      if (!isProfile(body.profile)) throw new Error("The saved workspace profile is incomplete or unreadable.");
      if ((body.profile as WorkspaceConfig & { requiresOwnerReview?: boolean }).requiresOwnerReview) {
        setBootstrap({ status: "onboarding", profile: body.profile });
        return;
      }
      setBootstrap({ status: "ready", profile: body.profile });
    } catch (cause) {
      if (!mounted.current) return;
      const aborted = cause instanceof DOMException && cause.name === "AbortError";
      setBootstrap({ status: "error", message: aborted
        ? "ACC could not finish loading your workspace in time. Nothing was changed. Retry to continue."
        : cause instanceof Error ? cause.message : "We could not load your workspace profile." });
    }
  }, []);

  const enterAcc = useCallback(async () => {
    setBootstrap({ status: "loading" });
    try {
      await openAccSession();
      if (!mounted.current) return;
      await loadProfile();
    } catch (cause) {
      if (!mounted.current) return;
      setBootstrap({ status: "error", message: cause instanceof Error ? cause.message : "ACC could not open your workspace." });
    }
  }, [loadProfile]);

  // Returning visitor with a live session: load straight into the workspace.
  useEffect(() => {
    if (!initialIdentity) return;
    const timeout = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timeout);
  }, [initialIdentity, loadProfile]);

  const saveProfile = useCallback(async (profile: WorkspaceConfig) => {
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    const body = await response.json() as { profile?: unknown; error?: string };
    if (!response.ok) throw new Error(body.error || "We could not save this workspace. Your previous values have not been changed.");
    if (!isProfile(body.profile)) throw new Error("The workspace was saved, but the response was incomplete.");
    if (!mounted.current) return;
    setBootstrap({ status: "ready", profile: body.profile });
    setEditing(null);
  }, []);

  if (bootstrap.status === "landing") return <GuestLanding onOpen={() => void enterAcc()} />;
  if (bootstrap.status === "loading") return <AppLoading />;
  if (bootstrap.status === "error") return <main className="bootstrap-error"><AccLogo /><DataUnavailableState title="Unable to load your workspace" message={bootstrap.message} onRetry={() => void enterAcc()} /><button className="button button-quiet" onClick={() => void signOutAcc()}>Start a new workspace</button></main>;

  const guestUser = { displayName: initialIdentity?.displayName ?? "Guest", email: initialIdentity?.optionalContactEmail ?? "" };
  if (bootstrap.status === "onboarding") return <OnboardingFlow user={guestUser} initial={bootstrap.profile} onComplete={saveProfile} />;
  if (editing) return <OnboardingFlow user={guestUser} initial={bootstrap.profile} openingBalancesLocked={editing.openingBalancesLocked} onComplete={saveProfile} onCancel={() => setEditing(null)} />;

  return <Workspace config={bootstrap.profile} onSignOut={() => void signOutAcc()} onEditProfile={(openingBalancesLocked) => setEditing({ openingBalancesLocked })} />;
}

function GuestLanding({ onOpen }: { onOpen: () => void }) {
  const [opening, setOpening] = useState(false);
  const open = () => { setOpening(true); onOpen(); };
  return (
    <main className="auth-shell">
      <div className="auth-orb auth-orb-green" aria-hidden="true" />
      <div className="auth-orb auth-orb-oxblood" aria-hidden="true" />
      <header className="auth-top"><AccLogo /><span>Your business, made clear</span></header>
      <section className="auth-hero">
        <div className="auth-copy">
          <p className="eyebrow">WELCOME TO ACC</p>
          <h1>Your personal<br />AI accountant.</h1>
          <p className="auth-lede">Tell ACC what happened in everyday words. See where the money went, then approve it when it looks right.</p>
          <button className="button button-primary auth-action" onClick={open} disabled={opening} aria-busy={opening}>
            {opening ? "Opening ACC…" : "Open ACC"} <span aria-hidden="true">→</span>
          </button>
          <p className="auth-disclosure">No sign-up and no password. ACC opens a private workspace for this browser instantly.</p>
        </div>
        <div className="auth-instrument" aria-label="A transaction moving through ACC">
          <div className="instrument-halo" aria-hidden="true" />
          <div className="instrument-rail" aria-hidden="true"><i /><i /><i /></div>
          <div className="instrument-layer source-layer"><span>YOU SAY</span><strong>“Paid ₹1,200 for supplies”</strong><small>Everyday language</small></div>
          <div className="instrument-layer journal-layer"><span>ACC ORGANISES</span><strong>Supplies ↔ Bank</strong><small>Ready for your review</small></div>
          <div className="instrument-layer effect-layer"><span>YOU SEE</span><strong>Money out · ₹1,200</strong><small>Simple business effect</small></div>
          <p><i aria-hidden="true" /> You stay in control</p>
        </div>
      </section>
      <section className="auth-product-grid" aria-label="What ACC does">
        <article><span>01 · DESCRIBE</span><h2>Say what happened.</h2><p>Use everyday words for sales, expenses, capital, assets, liabilities, returns, GST, collections, and payments.</p></article>
        <article><span>02 · REVIEW</span><h2>See both sides.</h2><p>ACC shows the source, debit, credit, amount, and business effect before a record can enter your books.</p></article>
        <article><span>03 · APPROVE</span><h2>Post once.</h2><p>Accounting rules validate the draft. Only your approval posts the journal entry and updates every connected report.</p></article>
      </section>
      <section className="auth-trust-strip">
        <div><span>SECURE BY DESIGN</span><h2>Your records belong to a private workspace on this browser—never a shared account.</h2></div>
        <p>ACC uses server sessions with an immutable internal identity, owner-scoped records, review-before-posting controls, audit events, complete data export, and permanent deletion. You can add an optional recovery email later. Provider secrets stay on the server.</p>
        <button className="button button-secondary" onClick={open} disabled={opening}>Open ACC</button>
      </section>
      <footer className="auth-footer"><span>Understand your money</span><span>Review before posting</span><span>Built for Indian businesses</span></footer>
    </main>
  );
}

function AppLoading() {
  return <main className="app-loading" aria-busy="true"><div className="loading-bar"><AccLogo /><span>Private workspace</span></div><div className="loading-stage"><i /><i /><i /><p>Opening your workspace…</p></div></main>;
}

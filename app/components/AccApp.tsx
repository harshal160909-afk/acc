"use client";

import { useCallback, useEffect, useState } from "react";
import { DataUnavailableState } from "./FinancialUI";
import { OnboardingFlow } from "./OnboardingFlow";
import type { BusinessType, LegalStructure, WorkspaceConfig } from "./types";
import { Workspace } from "./Workspace";

type AuthenticatedUser = {
  displayName: string;
  email: string;
};

type Props = {
  authenticatedUser: AuthenticatedUser | null;
  signInPath: string;
  signOutPath: string;
};

type BootstrapState =
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

export function AccApp({ authenticatedUser, signInPath, signOutPath }: Props) {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: "loading" });
  const [editing, setEditing] = useState<{ openingBalancesLocked: boolean } | null>(null);

  const loadProfile = useCallback(async () => {
    if (!authenticatedUser) return;
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      const body = await response.json() as { profile?: unknown; error?: string };
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
      setBootstrap({ status: "error", message: cause instanceof Error ? cause.message : "We could not load your workspace profile." });
    }
  }, [authenticatedUser]);

  useEffect(() => {
    if (!authenticatedUser) return;
    const timeout = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timeout);
  }, [authenticatedUser, loadProfile]);

  if (!authenticatedUser) return <AuthLanding signInPath={signInPath} />;

  async function saveProfile(profile: WorkspaceConfig) {
    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    const body = await response.json() as { profile?: unknown; error?: string };
    if (!response.ok) throw new Error(body.error || "We could not save this workspace. Your previous values have not been changed.");
    if (!isProfile(body.profile)) throw new Error("The workspace was saved, but the response was incomplete.");
    setBootstrap({ status: "ready", profile: body.profile });
    setEditing(null);
  }

  if (bootstrap.status === "loading") return <AppLoading email={authenticatedUser.email} />;
  if (bootstrap.status === "error") return <main className="bootstrap-error"><AccLogo /><DataUnavailableState title="Unable to load your workspace" message={bootstrap.message} onRetry={() => { setBootstrap({ status: "loading" }); void loadProfile(); }} /><a className="button button-quiet" href={signOutPath}>Sign out</a></main>;
  if (bootstrap.status === "onboarding") return <OnboardingFlow user={authenticatedUser} initial={bootstrap.profile} onComplete={saveProfile} />;
  if (editing) return <OnboardingFlow user={authenticatedUser} initial={bootstrap.profile} openingBalancesLocked={editing.openingBalancesLocked} onComplete={saveProfile} onCancel={() => setEditing(null)} />;

  return <Workspace config={bootstrap.profile} signOutPath={signOutPath} onEditProfile={(openingBalancesLocked) => setEditing({ openingBalancesLocked })} />;
}

function AuthLanding({ signInPath }: { signInPath: string }) {
  const [authMessage, setAuthMessage] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("error") === "access_denied" || params.get("auth") === "cancelled") setAuthMessage("Sign-in was cancelled. Nothing was created or changed.");
      else if (params.get("auth") === "configuration_required") setAuthMessage("Google sign-in is not configured on this deployment yet. The workspace remains locked until the site owner adds the approved Google OAuth credentials.");
      else if (params.get("auth") === "invalid_state") setAuthMessage("That sign-in attempt expired or could not be verified. Start again from this page.");
      else if (params.get("auth") === "failed") setAuthMessage("Google sign-in could not be completed. No business records were changed.");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

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
          <a className="button button-primary auth-action" href={signInPath}><span className="google-mark" aria-hidden="true">G</span> Continue with Google <span aria-hidden="true">→</span></a>
          <p className="auth-disclosure">Your account is confirmed on the next screen. ACC does not see or store your password.</p>
          {authMessage ? <p className="auth-message" role="alert">{authMessage}</p> : null}
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
        <div><span>SECURE BY DESIGN</span><h2>Your records belong to your Google identity—not an email header.</h2></div>
        <p>ACC uses server sessions, owner-scoped records, review-before-posting controls, audit events, complete data export, and permanent account deletion. Provider secrets stay on the server.</p>
        <a className="button button-secondary" href={signInPath}>Sign in with Google</a>
      </section>
      <footer className="auth-footer"><span>Understand your money</span><span>Review before posting</span><span>Built for Indian businesses</span></footer>
    </main>
  );
}

function AppLoading({ email }: { email: string }) {
  return <main className="app-loading" aria-busy="true"><div className="loading-bar"><AccLogo /><span>{email}</span></div><div className="loading-stage"><i /><i /><i /><p>Opening your workspace…</p></div></main>;
}

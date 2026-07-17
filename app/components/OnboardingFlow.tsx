"use client";

import { useMemo, useState } from "react";
import { formatINR, parseMoneyInput } from "../lib/money";
import { MoneyInput, MoneyValue } from "./FinancialUI";
import type { BusinessType, LegalStructure, WorkspaceConfig } from "./types";

type AuthenticatedUser = {
  displayName: string;
  email: string;
};

type Props = {
  user: AuthenticatedUser;
  initial?: WorkspaceConfig;
  openingBalancesLocked?: boolean;
  onComplete: (profile: WorkspaceConfig) => Promise<void>;
  onCancel?: () => void;
};

const BUSINESS_TYPES: Array<{ value: BusinessType; label: string; note: string }> = [
  { value: "freelancer", label: "Freelancer", note: "Independent professional work" },
  { value: "service", label: "Service business", note: "Fees for time or expertise" },
  { value: "retail", label: "Retail business", note: "Goods sold directly to customers" },
  { value: "ecommerce", label: "E-commerce", note: "Online sales and marketplaces" },
  { value: "agency", label: "Agency", note: "Client projects and retainers" },
  { value: "manufacturing", label: "Manufacturing", note: "Goods produced for sale" },
  { value: "nonprofit", label: "Non-profit", note: "Purpose-led organisation" },
  { value: "personal", label: "Personal finances", note: "Individual money records" },
  { value: "other", label: "Other", note: "Describe it in your own words" },
];

const LEGAL_STRUCTURES: Array<{ value: LegalStructure; label: string; note: string }> = [
  { value: "not_specified", label: "Skip for now", note: "You can add this later" },
  { value: "sole", label: "Sole proprietor", note: "One owner" },
  { value: "partnership", label: "Partnership", note: "Two or more partners" },
  { value: "private", label: "Private limited", note: "Registered private company" },
];

const BUSINESS_LABELS = Object.fromEntries(BUSINESS_TYPES.map((item) => [item.value, item.label])) as Record<BusinessType, string>;
const LEGAL_LABELS = Object.fromEntries(LEGAL_STRUCTURES.map((item) => [item.value, item.label])) as Record<LegalStructure, string>;

function currentFinancialYear() {
  const today = new Date();
  const start = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${start}–${String(start + 1).slice(-2)}`;
}

function initialDraft(user: AuthenticatedUser, initial?: WorkspaceConfig) {
  return {
    ownerName: initial?.ownerName ?? user.displayName,
    businessName: initial?.businessName ?? "",
    businessType: initial?.businessType ?? ("service" as BusinessType),
    customBusinessType: initial?.customBusinessType ?? "",
    legalStructure: initial?.legalStructure ?? ("not_specified" as LegalStructure),
    bankInput: initial ? formatINR(initial.openingBankPaise) : "",
    cashInput: initial ? formatINR(initial.cashInHandPaise) : "",
    capitalInput: initial ? formatINR(initial.openingCapitalPaise) : "",
    connectionMode: "manual" as const,
  };
}

export function OnboardingFlow({ user, initial, openingBalancesLocked = false, onComplete, onCancel }: Props) {
  // Progressive onboarding. A first-time visitor completes a three-field fast
  // start (name, business, type) and lands in the workspace immediately —
  // opening balances, legal structure and other details are deferred to the
  // "Finish setup" checklist inside Books (the edit flow below reaches them).
  const fastStart = !initial;
  const [step, setStep] = useState(initial ? 8 : 0);
  const [draft, setDraft] = useState(() => initialDraft(user, initial));
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const totalSteps = fastStart ? 3 : 9;
  const isLast = fastStart ? step === 2 : step === 8;

  const bank = useMemo(() => draft.bankInput ? parseMoneyInput(draft.bankInput) : { valid: true as const, amountPaise: 0, ok: true as const, paise: 0 }, [draft.bankInput]);
  const cash = useMemo(() => draft.cashInput ? parseMoneyInput(draft.cashInput) : { valid: true as const, amountPaise: 0, ok: true as const, paise: 0 }, [draft.cashInput]);
  const capital = useMemo(() => draft.capitalInput ? parseMoneyInput(draft.capitalInput) : { valid: true as const, amountPaise: 0, ok: true as const, paise: 0 }, [draft.capitalInput]);
  const openingTotalPaise = useMemo(
    () => bank.ok && cash.ok && Number.isSafeInteger(bank.paise + cash.paise) ? bank.paise + cash.paise : null,
    [bank, cash],
  );

  function validateCurrent() {
    if (step === 0 && draft.ownerName.trim().length < 2) return "Enter the name of the person opening the books.";
    if (step === 1 && draft.businessName.trim().length < 2) return "Enter the business name.";
    if (step === 2 && draft.businessType === "other" && draft.customBusinessType.trim().length < 2) return "Describe the business type.";
    if (step === 4 && !bank.ok) return bank.error;
    if (step === 5 && !cash.ok) return cash.error;
    if (step === 6 && !capital.ok) return capital.error;
    if (step === 5 && openingTotalPaise === null) return "Those opening balances are too large. Please check the amounts.";
    return "";
  }

  function move(next: number) {
    const issue = validateCurrent();
    if (next > step && issue) {
      setError(issue);
      return;
    }
    setError("");
    setFocused(false);
    setStep(next);
  }

  async function finish() {
    if (draft.ownerName.trim().length < 2) { setStep(0); setError("Enter the name of the person opening the books."); return; }
    if (draft.businessName.trim().length < 2) { setStep(1); setError("Enter the business name."); return; }
    if (draft.businessType === "other" && draft.customBusinessType.trim().length < 2) { setStep(2); setError("Review and describe the business type before saving this workspace."); return; }
    if (!bank.ok) { setError(bank.error); return; }
    if (!cash.ok) { setError(cash.error); return; }
    if (!capital.ok) { setStep(6); setError(capital.error); return; }
    if (openingTotalPaise === null) { setStep(5); setError("Those opening balances are too large. Please check the amounts."); return; }
    setSaving(true);
    setError("");
    try {
      await onComplete({
        ownerName: draft.ownerName.trim(),
        email: user.email,
        businessName: draft.businessName.trim(),
        businessType: draft.businessType,
        customBusinessType: draft.businessType === "other" ? draft.customBusinessType.trim() : "",
        legalStructure: draft.legalStructure,
        openingBankPaise: bank.paise,
        cashInHandPaise: cash.paise,
        openingCapitalPaise: capital.paise,
        connectionMode: "manual",
        financialYear: initial?.financialYear ?? currentFinancialYear(),
        updatedAt: initial?.updatedAt,
        setupCompletedAt: initial?.setupCompletedAt,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not create your workspace. Your answers are still here.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`onboarding-shell${focused ? " is-focused" : ""}`}>
      <header className="onboarding-top glass-bar">
        <div className="acc-wordmark"><span aria-hidden="true">A</span><strong>ACC</strong></div>
        <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${totalSteps}`}>
          <div><span>Workspace setup</span><strong>{String(step + 1).padStart(2, "0")} / {String(totalSteps).padStart(2, "0")}</strong></div>
          <i><b style={{ width: `${((step + 1) / totalSteps) * 100}%` }} /></i>
        </div>
        <div className="authenticated-chip"><span>Private workspace</span><strong>{user.email || "Linked to this browser"}</strong></div>
      </header>

      <section className="onboarding-stage">
        <div className="onboarding-ambient" aria-hidden="true"><i /><i /><i /></div>
        <form className="onboarding-card" onSubmit={(event) => { event.preventDefault(); if (isLast) void finish(); else move(step + 1); }}>
          <div className="onboarding-step" key={step}>
            {step === 0 ? (
              <>
                <StepHeading number="01" title="First, what’s your name?" body="ACC will use it to make the workspace feel like yours." />
                <label className="focus-field" htmlFor="owner-name">Your name
                  <input id="owner-name" value={draft.ownerName} onChange={(event) => setDraft({ ...draft, ownerName: event.target.value })} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoFocus autoComplete="name" aria-invalid={Boolean(error)} />
                </label>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <StepHeading number="02" title="What’s your business called?" body="Use the name you see every day. You can change it later." />
                <label className="focus-field" htmlFor="business-name">Business name
                  <input id="business-name" value={draft.businessName} onChange={(event) => setDraft({ ...draft, businessName: event.target.value })} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoFocus autoComplete="organization" aria-invalid={Boolean(error)} placeholder="Your business name" />
                </label>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <StepHeading number="03" title="How does the business earn money?" body="Choose the closest match so ACC can speak your language." />
                <div className="choice-grid" role="radiogroup" aria-label="Business type">
                  {BUSINESS_TYPES.map((item) => <button type="button" role="radio" aria-checked={draft.businessType === item.value} className={draft.businessType === item.value ? "selected" : ""} key={item.value} onClick={() => setDraft({ ...draft, businessType: item.value })}><strong>{item.label}</strong><span>{item.note}</span></button>)}
                </div>
                {draft.businessType === "other" ? <label className="compact-field" htmlFor="custom-type">Describe the business<input id="custom-type" value={draft.customBusinessType} onChange={(event) => setDraft({ ...draft, customBusinessType: event.target.value })} autoFocus /></label> : null}
                {fastStart ? <p className="onboarding-defer-note">That’s all ACC needs to begin. You can add opening balances and other details any time from <strong>Finish setup</strong> in Books.</p> : null}
              </>
            ) : null}

            {step === 3 ? (
              <>
                <StepHeading number="04" title="How is the business registered?" body="Choose what fits today, or skip this for now." />
                <div className="choice-grid choice-grid-two" role="radiogroup" aria-label="Legal structure">
                  {LEGAL_STRUCTURES.map((item) => <button type="button" role="radio" aria-checked={draft.legalStructure === item.value} className={draft.legalStructure === item.value ? "selected" : ""} key={item.value} onClick={() => setDraft({ ...draft, legalStructure: item.value })}><strong>{item.label}</strong><span>{item.note}</span></button>)}
                  <button type="button" disabled><strong>Public company</strong><span>Coming later</span></button>
                </div>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <StepHeading number="05" title="How much is in the business bank?" body="Add the amount available today. Skip if you’re starting fresh." />
                {openingBalancesLocked && initial ? <LockedOpeningBalance label="Cash at bank" amountPaise={initial.openingBankPaise} /> : <MoneyInput label="Cash at bank" value={draft.bankInput} onChange={(value) => setDraft({ ...draft, bankInput: value })} help="Optional. Enter 0 or skip if there is no opening bank cash." error={error || undefined} autoFocus onFocusChange={setFocused} />}
              </>
            ) : null}

            {step === 5 ? (
              <>
                <StepHeading number="06" title="Any business cash in hand?" body="Count only physical cash you can use today." />
                {openingBalancesLocked && initial ? <LockedOpeningBalance label="Cash in hand" amountPaise={initial.cashInHandPaise} /> : <MoneyInput label="Cash in hand" value={draft.cashInput} onChange={(value) => setDraft({ ...draft, cashInput: value })} help="Optional. This stays separate from the bank balance." error={error || undefined} autoFocus onFocusChange={setFocused} />}
              </>
            ) : null}

            {step === 6 ? (
              <>
                <StepHeading number="07" title="What is the opening capital?" body="Enter the owner or partners' money already put into the business. Use 0 if none has been introduced yet." />
                {openingBalancesLocked && initial ? <LockedOpeningBalance label="Opening capital" amountPaise={initial.openingCapitalPaise} /> : <MoneyInput label="Opening capital" value={draft.capitalInput} onChange={(value) => setDraft({ ...draft, capitalInput: value })} help="This is the funding source shown under Capital in the Balance Sheet." error={error || undefined} autoFocus onFocusChange={setFocused} />}
              </>
            ) : null}

            {step === 7 ? (
              <>
                <StepHeading number="08" title="How would you like to begin?" body="Start by telling ACC what happened. A bank connection can be added later." />
                <div className="connection-choice">
                  <button type="button" className="selected" aria-pressed="true"><i aria-hidden="true" /><span><strong>Tell ACC what happened</strong><small>Add income and expenses in everyday words.</small></span><b>Ready</b></button>
                  <button type="button" disabled><i aria-hidden="true" /><span><strong>Connect a bank</strong><small>Automatic imports are coming later.</small></span><b>Coming later</b></button>
                </div>
              </>
            ) : null}

            {step === 8 && bank.ok && cash.ok && capital.ok && openingTotalPaise !== null ? (
              <>
                <StepHeading number="09" title={initial ? "Review your workspace" : "Ready to meet your business."} body="Take one last look. You can edit these details from the business menu." />
                <div className="setup-review">
                  <ReviewRow label="Owner" value={draft.ownerName} onEdit={() => move(0)} />
                  <ReviewRow label="Business" value={draft.businessName} onEdit={() => move(1)} />
                  <ReviewRow label="Business type" value={draft.businessType === "other" ? draft.customBusinessType || "Needs review" : BUSINESS_LABELS[draft.businessType]} onEdit={() => move(2)} />
                  <ReviewRow label="Registration" value={LEGAL_LABELS[draft.legalStructure]} onEdit={() => move(3)} />
                  <ReviewRow label="Cash at bank" value={<MoneyValue amountPaise={bank.paise} />} onEdit={openingBalancesLocked ? undefined : () => move(4)} />
                  <ReviewRow label="Cash in hand" value={<MoneyValue amountPaise={cash.paise} />} onEdit={openingBalancesLocked ? undefined : () => move(5)} />
                  <ReviewRow label="Opening capital" value={<MoneyValue amountPaise={capital.paise} />} onEdit={openingBalancesLocked ? undefined : () => move(6)} />
                  <ReviewRow label="How you’ll begin" value="Tell ACC what happened" onEdit={() => move(7)} />
                </div>
                <div className="review-proof"><span>Your opening view</span><strong>{openingTotalPaise > 0 ? `${formatINR(openingTotalPaise)} available to begin` : "A clean workspace, ready for your first entry"}</strong></div>
              </>
            ) : null}
          </div>

          {error ? <p className="onboarding-error" role="alert">{error}</p> : null}
          <footer className="onboarding-actions">
            <button type="button" className="button button-quiet" onClick={() => step > 0 ? move(step - 1) : onCancel?.()} disabled={saving}>{step === 0 ? (onCancel ? "Cancel" : "") : "Back"}</button>
            {(step === 4 || step === 5) && !openingBalancesLocked ? <button type="button" className="button button-quiet skip-action" onClick={() => { setDraft(step === 4 ? { ...draft, bankInput: "₹0" } : { ...draft, cashInput: "₹0" }); setError(""); setStep(step + 1); }}>Skip for now</button> : null}
            <button className="button button-primary" type="submit" disabled={saving}>{isLast ? (saving ? "Creating workspace…" : initial ? "Save workspace" : "Open my workspace") : "Continue"}<span aria-hidden="true">→</span></button>
          </footer>
        </form>
      </section>
    </main>
  );
}

function StepHeading({ number, title, body }: { number: string; title: string; body: string }) {
  return <header className="step-heading"><span>{number} / SETUP</span><h1>{title}</h1><p>{body}</p></header>;
}

function ReviewRow({ label, value, onEdit }: { label: string; value: React.ReactNode; onEdit?: () => void }) {
  return <div><span>{label}</span><strong>{value}</strong>{onEdit ? <button type="button" onClick={onEdit}>Edit</button> : <small>Locked</small>}</div>;
}

function LockedOpeningBalance({ label, amountPaise }: { label: string; amountPaise: number }) {
  return <div className="locked-opening"><span>{label}</span><MoneyValue amountPaise={amountPaise} /><p>Locked after the first posted entry. Record a new adjustment through the Journal instead of rewriting history.</p></div>;
}

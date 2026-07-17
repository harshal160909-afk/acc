"use client";

import { useId } from "react";
import { formatINR, parseMoneyInput } from "../lib/money";
import type { MoneyMetric } from "./types";

type MoneyInputProps = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  help: string;
  error?: string;
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
};

export function MoneyInput({
  id,
  label,
  value,
  onChange,
  help,
  error,
  autoFocus,
  onFocusChange,
}: MoneyInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const parsed = parseMoneyInput(value);

  return (
    <div className="money-input-wrap">
      <label htmlFor={inputId}>{label}</label>
      <div className="money-input-line">
        <span aria-hidden="true">₹</span>
        <input
          id={inputId}
          value={value.replace(/^\s*₹\s?/, "")}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => {
            onFocusChange?.(false);
            if (parsed.ok) onChange(formatINR(parsed.paise));
          }}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          aria-invalid={Boolean(error)}
          aria-describedby={`${helpId}${error ? ` ${errorId}` : ""}`}
          autoFocus={autoFocus}
        />
      </div>
      <div className="money-input-meta"><p id={helpId}>{help}</p></div>
      {error ? <p className="field-error" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}

export function MoneyValue({ amountPaise, className = "" }: { amountPaise: number; className?: string }) {
  return <span className={`money-value ${className}`.trim()}>{formatINR(amountPaise)}</span>;
}

type FinancialMetricCardProps = {
  title: string;
  metric: MoneyMetric;
  context: string;
  explanation: string;
  tone?: "default" | "positive" | "negative";
  onInspect?: () => void;
};

export function FinancialMetricCard({
  title,
  metric,
  context,
  explanation,
  tone = "default",
  onInspect,
}: FinancialMetricCardProps) {
  const content = (
    <>
      <div className="metric-card-top">
        <span>{title}</span>
        <i aria-hidden="true" />
      </div>
      <MoneyValue amountPaise={metric.amountPaise} />
      <p className="metric-context">{context}</p>
      <p className="metric-explanation">{explanation}</p>
    </>
  );

  return onInspect ? (
    <button className={`metric-card metric-${tone}`} onClick={onInspect} aria-label={`Inspect ${title}`}>
      {content}
    </button>
  ) : (
    <article className={`metric-card metric-${tone}`}>{content}</article>
  );
}

export function EmptyFinancialState({
  eyebrow,
  title,
  body,
  actionLabel,
  onAction,
}: {
  eyebrow: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="financial-empty">
      <span>{eyebrow}</span>
      <h3>{title}</h3>
      <p>{body}</p>
      {actionLabel && onAction ? <button className="button button-secondary" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  );
}

export function DataUnavailableState({
  title = "Unable to load data",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="data-unavailable" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      {onRetry ? <button className="button button-secondary" onClick={onRetry}>Retry</button> : null}
    </div>
  );
}

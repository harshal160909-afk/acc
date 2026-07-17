"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deriveJournalLines, formatDisplayDate, transactionTypeLabel } from "../lib/finance";
import { formatINR } from "../lib/money";
import type { JournalLine, PostedEntry, TransactionDraft } from "./types";

type ContextName = "books" | "business" | "investments" | "market_news";
type Thread = { id: string; title: string; context: ContextName; createdAt: number; updatedAt: number };
type ProposalMeta = { draftId?: string; draft?: TransactionDraft; journalLines?: JournalLine[]; financialEffect?: string; confidence?: number; sources?: string[]; inventoryCostStatus?: string };
type Message = { id: string; role: "user" | "assistant"; kind: string; content: string; provider?: string | null; model?: string | null; metadata?: ProposalMeta; createdAt: number; streaming?: boolean; proposal?: ProposalMeta; status?: "pending" | "posted" | "cancelled" };

const CONTEXTS: Array<{ value: ContextName; label: string }> = [
  { value: "books", label: "My books" }, { value: "business", label: "Business" },
  { value: "investments", label: "Investments" }, { value: "market_news", label: "Market & news" },
];

function uniqueId() { return crypto.randomUUID(); }

function ProposalCard({ proposal, status, onApprove, onCancel, onRevise }: { proposal: ProposalMeta; status?: Message["status"]; onApprove: () => Promise<void>; onCancel: () => Promise<void>; onRevise: () => void }) {
  const [busy, setBusy] = useState<"approve" | "cancel" | null>(null);
  const [error, setError] = useState("");
  const draft = proposal.draft;
  if (!draft) return null;
  const lines = proposal.journalLines ?? deriveJournalLines(draft);
  const totalDebit = lines.reduce((sum, line) => sum + line.debitPaise, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.creditPaise, 0);
  const completed = status === "posted" || status === "cancelled";
  async function run(kind: "approve" | "cancel", action: () => Promise<void>) {
    setBusy(kind); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "That action could not be completed."); }
    finally { setBusy(null); }
  }
  return <section className="ai-proposal" aria-label="Transaction awaiting approval">
    <header><span>{status === "posted" ? "POSTED" : status === "cancelled" ? "CANCELLED" : "REVIEW BEFORE POSTING"}</span><strong>{transactionTypeLabel(draft.transactionType)}</strong></header>
    <div className="ai-proposal-summary"><div><small>What happened</small><strong>{draft.description}</strong><span>{formatDisplayDate(draft.date)}{draft.counterparty ? ` · ${draft.counterparty}` : ""}</span></div><div><small>Amount</small><strong>{formatINR(draft.amountPaise)}</strong></div></div>
    <div className="ai-journal"><div className="ai-journal-head"><span>Account</span><span>Debit</span><span>Credit</span></div>{lines.map((line, index) => <div key={`${line.account}-${index}`}><strong>{line.account}</strong><span>{line.debitPaise ? formatINR(line.debitPaise) : "—"}</span><span>{line.creditPaise ? formatINR(line.creditPaise) : "—"}</span></div>)}<footer><strong>Balanced total</strong><span>{formatINR(totalDebit)}</span><span>{formatINR(totalCredit)}</span></footer></div>
    {proposal.inventoryCostStatus === "pending" ? <p className="ai-proposal-warning">Inventory cost is pending, so this sale does not include cost of goods sold yet. Add the real cost later; ACC has not guessed it.</p> : null}
    {proposal.financialEffect ? <p className="ai-effect"><span>Simple effect</span>{proposal.financialEffect}</p> : null}
    {error ? <p className="modal-error" role="alert">{error}</p> : null}
    <footer className="ai-proposal-actions"><button className="button button-quiet" disabled={Boolean(busy) || completed} onClick={() => void run("cancel", onCancel)}>Cancel</button><button className="button button-secondary" disabled={Boolean(busy) || completed} onClick={onRevise}>Revise</button><button className="button button-primary" disabled={Boolean(busy) || completed || totalDebit !== totalCredit} onClick={() => void run("approve", onApprove)}>{busy === "approve" ? "Posting…" : status === "posted" ? "Posted" : "Approve & post"}</button></footer>
  </section>;
}

export function AskAccView({ onPost, onOpenSettings }: { onPost: (draft: TransactionDraft) => Promise<PostedEntry>; onOpenSettings: () => void }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [context, setContext] = useState<ContextName>("books");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const requestController = useRef<AbortController | null>(null);

  const createThread = useCallback(async (nextContext: ContextName = context) => {
    const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_thread", context: nextContext, title: "New conversation" }) });
    const body = await response.json() as { thread?: Thread; error?: string };
    if (!response.ok || !body.thread) throw new Error(body.error || "A conversation could not be created.");
    setThreads((current) => [body.thread as Thread, ...current]); setActiveId(body.thread.id); setMessages([]); setContext(body.thread.context); return body.thread;
  }, [context]);

  const loadThread = useCallback(async (threadId: string) => {
    const response = await fetch(`/api/ai?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" });
    const body = await response.json() as { threads?: Thread[]; messages?: Message[]; error?: string };
    if (!response.ok) throw new Error(body.error || "Conversation history is unavailable.");
    setThreads(body.threads ?? []); setMessages((body.messages ?? []).map((message) => ({ ...message, proposal: message.kind === "proposal" ? message.metadata : undefined, status: "pending" })));
    const thread = body.threads?.find((item) => item.id === threadId); if (thread) setContext(thread.context);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/ai", { cache: "no-store" }); const body = await response.json() as { threads?: Thread[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Ask ACC is unavailable.");
        if (cancelled) return;
        setThreads(body.threads ?? []);
        if (body.threads?.[0]) { setActiveId(body.threads[0].id); setContext(body.threads[0].context); await loadThread(body.threads[0].id); }
        else await createThread("books");
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Ask ACC is unavailable."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [createThread, loadThread]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [messages]);

  async function selectThread(thread: Thread) { setActiveId(thread.id); setContext(thread.context); setLoading(true); setError(""); try { await loadThread(thread.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Conversation is unavailable."); } finally { setLoading(false); } }

  async function deleteThread(threadId: string) {
    const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete_thread", threadId }) });
    if (!response.ok) return;
    const remaining = threads.filter((thread) => thread.id !== threadId); setThreads(remaining);
    if (activeId === threadId) { if (remaining[0]) { setActiveId(remaining[0].id); await loadThread(remaining[0].id); } else await createThread("books"); }
  }

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault(); const content = input.trim(); if (!content || sending) return;
    setSending(true); setError(""); setInput("");
    try {
      const controller = new AbortController(); requestController.current = controller;
      const thread = activeId ? { id: activeId } : await createThread(context);
      const userMessage: Message = { id: uniqueId(), role: "user", kind: "message", content, createdAt: Date.now() };
      const assistantId = uniqueId();
      setMessages((current) => [...current, userMessage, { id: assistantId, role: "assistant", kind: "message", content: "", createdAt: Date.now(), streaming: true }]);
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "message", threadId: thread.id, content }), signal: controller.signal });
      if (!response.ok || !response.body) { const body = await response.json() as { error?: string }; throw new Error(body.error || "ACC could not answer."); }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const blocks = buffer.split("\n\n"); buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const eventName = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const dataText = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim(); if (!eventName || !dataText) continue;
          const data = JSON.parse(dataText) as Record<string, unknown>;
          if (eventName === "delta" && typeof data.text === "string") setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + data.text } : message));
          if (eventName === "provider") setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, provider: typeof data.provider === "string" ? data.provider : null, model: typeof data.model === "string" ? data.model : null } : message));
          if (eventName === "proposal") setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, kind: "proposal", proposal: data as ProposalMeta, metadata: data as ProposalMeta, status: "pending" } : message));
          if (eventName === "error") throw new Error(typeof data.message === "string" ? data.message : "ACC could not answer.");
        }
        if (done) break;
      }
      setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, streaming: false } : message));
    } catch (cause) { setMessages((current) => current.filter((message) => !message.streaming)); if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "ACC could not answer."); }
    finally { requestController.current = null; setSending(false); }
  }

  function stopResponse() {
    requestController.current?.abort();
  }

  async function approve(message: Message) {
    if (!message.proposal?.draft) throw new Error("Draft details are unavailable. Ask ACC to create a new draft.");
    await onPost(message.proposal.draft);
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, status: "posted" } : item));
  }
  async function cancel(message: Message) {
    const draftId = message.proposal?.draftId ?? message.proposal?.draft?.aiDraftId;
    if (!draftId) throw new Error("Draft reference is unavailable.");
    const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel_draft", draftId }) });
    const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Draft could not be cancelled.");
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, status: "cancelled" } : item));
  }

  return <div className="ask-acc-view">
    <aside className="ai-thread-rail glass-panel"><header><div><span>ASK ACC</span><strong>Conversations</strong></div><button onClick={() => void createThread(context)} aria-label="New conversation">＋</button></header><div>{threads.map((thread) => <article key={thread.id} className={activeId === thread.id ? "active" : ""}><button onClick={() => void selectThread(thread)}><strong>{thread.title}</strong><span>{CONTEXTS.find((item) => item.value === thread.context)?.label}</span></button><button onClick={() => void deleteThread(thread.id)} aria-label={`Delete ${thread.title}`}>×</button></article>)}</div></aside>
    <section className="ai-conversation glass-panel"><header><div><span className="assistant-mark">A</span><div><strong>Ask ACC</strong><small>Plain answers. Your books change only after approval.</small></div></div><select value={context} onChange={(event) => setContext(event.target.value as ContextName)} aria-label="Conversation context">{CONTEXTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></header>
      <div className="ai-message-list">{loading ? <p className="ai-empty">Opening your conversation…</p> : null}{!loading && messages.length === 0 ? <div className="ai-welcome"><span>ACC</span><h2>What happened today?</h2><p>Describe a sale, payment, asset, loan, capital, drawing, bad debt, provision, or investment in everyday words.</p><div><button onClick={() => setInput("I received ₹25,000 from a customer by bank today")}>Record money received</button><button onClick={() => setInput("Explain my current cash and profit")}>Explain my business</button><button onClick={() => setInput("I bought equipment for ₹60,000 by bank today")}>Record an asset</button></div></div> : null}{messages.map((message) => <article key={message.id} className={`ai-message ${message.role}`}><header><span>{message.role === "user" ? "YOU" : "ACC"}</span>{message.provider ? <small>{message.provider}{message.model ? ` · ${message.model}` : ""}</small> : null}</header>{message.content ? <p>{message.content}{message.streaming ? <i className="typing-caret" /> : null}</p> : <p><i className="typing-caret" /></p>}{message.proposal ? <ProposalCard proposal={message.proposal} status={message.status} onApprove={() => approve(message)} onCancel={() => cancel(message)} onRevise={() => { const draft = message.proposal?.draft; if (draft) setInput(`${draft.description} for ${formatINR(draft.amountPaise)} on ${draft.date}. Change: `); }} /> : null}</article>)}<div ref={endRef} /></div>
      {error ? <div className="ai-error" role="alert"><span>{error}</span>{/provider|configuration/i.test(error) ? <button onClick={onOpenSettings}>Open Settings</button> : null}</div> : null}
      <form className="ai-composer" onSubmit={(event) => void sendMessage(event)}><label htmlFor="ask-acc-input">Message ACC</label><div><textarea id="ask-acc-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder="For example: I paid ₹18,000 office rent from the bank today" rows={2} maxLength={2000} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} /><button type="submit" disabled={!input.trim() || sending}>{sending ? "…" : "↑"}<span className="sr-only">Send</span></button></div>{sending ? <button className="ai-stop-response" type="button" onClick={stopResponse}>Stop response</button> : null}<small>ACC can draft entries and explain records. It cannot post without your approval or execute trades.</small></form>
    </section>
  </div>;
}

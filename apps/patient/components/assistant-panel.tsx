"use client";

import { useState, type FormEvent } from "react";

type Capability = "answer_platform_question" | "guide_prescription_upload"
  | "explain_workflow_status" | "collect_administrative_information";

type AssistantResponse =
  | { kind: "answer"; text: string }
  | { kind: "escalated"; escalationId: string; reason: string };

export function AssistantPanel() {
  const [capability, setCapability] = useState<Capability>("answer_platform_question");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setAnswer(null);
    setError("");
    const form = new FormData(event.currentTarget);
    const question = String(form.get("question") ?? "").trim();
    const workflowStatus = String(form.get("workflowStatus") ?? "").trim();
    try {
      const response = await fetch("/patient/api/v1/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability,
          question,
          ...(capability === "explain_workflow_status" ? { workflowStatus } : {}),
        }),
      });
      if (!response.ok) throw new Error();
      const body = await response.json() as { data: AssistantResponse };
      setAnswer(body.data);
    } catch {
      setError("Alice is temporarily unavailable. Your request was not completed; please retry.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="card" onSubmit={submit}>
    <div className="field">
      <label htmlFor="assistant-capability">What do you need help with?</label>
      <select id="assistant-capability" value={capability} onChange={(event) => setCapability(event.target.value as Capability)}>
        <option value="answer_platform_question">Using MedLink</option>
        <option value="guide_prescription_upload">Uploading a prescription</option>
        <option value="explain_workflow_status">Understanding a workflow status</option>
        <option value="collect_administrative_information">Administrative information</option>
      </select>
    </div>
    {capability === "explain_workflow_status" ? <div className="field">
      <label htmlFor="workflow-status">Current status</label>
      <input id="workflow-status" name="workflowStatus" maxLength={100} required />
    </div> : null}
    <div className="field">
      <label htmlFor="assistant-question">Your question</label>
      <textarea id="assistant-question" name="question" maxLength={2000} required rows={5} />
    </div>
    <button className="button" disabled={busy} type="submit">{busy ? "Asking Alice…" : "Ask Alice"}</button>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {answer?.kind === "answer" ? <section className="notice" aria-live="polite"><h2>Alice</h2><p>{answer.text}</p></section> : null}
    {answer?.kind === "escalated" ? <section className="notice" aria-live="polite">
      <h2>A pharmacist will follow up</h2>
      <p>This question needs clinical judgment or requested an action Alice cannot perform. It was not answered or acted on.</p>
      <p className="muted">Support reference: {answer.escalationId}</p>
    </section> : null}
  </form>;
}

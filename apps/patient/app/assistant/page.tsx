import { AssistantPanel } from "../../components/assistant-panel";

export default function AssistantPage() {
  return <>
    <header className="head">
      <div>
        <div className="eyebrow">Patient support</div>
        <h1>Ask Alice</h1>
        <p className="muted">Get help using MedLink. Clinical questions are safely escalated to a pharmacist.</p>
      </div>
    </header>
    <AssistantPanel />
  </>;
}

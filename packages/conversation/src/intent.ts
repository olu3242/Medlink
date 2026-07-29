import type { MessageContentType } from "./models";
import type { DetectedIntent, IntentClassifier } from "./ports";

interface IntentRule {
  readonly intent: string;
  readonly keywords: readonly string[];
}

// RC1 baseline: a deterministic keyword classifier, not a machine-learning
// model -- docs/release-scope.md's Candidate C (assisted-intelligence
// expansion) entry criteria (approved clinical evaluation datasets, safety
// thresholds, an accountable clinical owner) aren't met, and are RC2 scope
// regardless. Any input matching no rule returns zero confidence rather
// than guessing; ConversationEngine treats that as a signal to hand off to
// a human rather than silently mis-routing a patient's message.
const intentRules: readonly IntentRule[] = [
  { intent: "prescription_upload", keywords: ["prescription", "script", " rx", "rx "] },
  {
    intent: "medicine_search",
    keywords: ["find", "search", "looking for", "need medicine", "need medication"],
  },
  { intent: "reservation_status", keywords: ["reservation", "order status", "my order"] },
  { intent: "refill_request", keywords: ["refill", "renew"] },
  {
    intent: "consultation_request",
    keywords: ["talk to pharmacist", "speak to pharmacist", "consultation", "question about my medicine"],
  },
  { intent: "greeting", keywords: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"] },
];

export class KeywordIntentClassifier implements IntentClassifier {
  async classify(input: {
    readonly body: string | null;
    readonly contentType: MessageContentType;
  }): Promise<DetectedIntent> {
    if (input.contentType === "image" || input.contentType === "document") {
      return { intent: "prescription_upload", confidence: 1 };
    }
    const text = ` ${(input.body ?? "").toLowerCase().trim()} `;
    if (text.trim() === "") return { intent: "unknown", confidence: 0 };
    for (const rule of intentRules) {
      if (rule.keywords.some((keyword) => text.includes(keyword))) {
        return { intent: rule.intent, confidence: 1 };
      }
    }
    return { intent: "unknown", confidence: 0 };
  }
}

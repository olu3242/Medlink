// A deterministic, pattern-based safety net for Alice (the Patient
// Experience Agent) -- NOT a certified clinical-safety NLP system. This is
// a heuristic second layer, not the primary control: the primary control
// is that every Alice prompt (see alice.ts's prompt definitions)
// explicitly instructs the model to refuse clinical questions. This module
// exists because a prompt instruction alone is not a structural guarantee
// -- the same "defense in depth, not a replacement for the real control"
// posture packages/agents' authorizeAgentCapability already documents for
// RBAC. Documented explicitly as a heuristic so it is never mistaken for
// more than it is.

const CLINICAL_ADVICE_REQUEST_PATTERNS: readonly RegExp[] = [
  /\bshould i take\b/i,
  /\bwhat (dose|dosage) (of|should)\b/i,
  /\bis it safe (to|for) (take|mix|combine)\b/i,
  /\bcan i take .* (with|and)\b/i,
  /\bdiagnos/i,
  /\bside effects? of\b/i,
  /\bwhich medicine (should|do) i\b/i,
  /\bhow much .* should i (take|use)\b/i,
];

const CLINICAL_DECISION_LANGUAGE_PATTERNS: readonly RegExp[] = [
  /\byou should take\b/i,
  /\bi recommend (taking|you take)\b/i,
  /\byour diagnosis\b/i,
  /\btake \d+\s?(mg|milligrams?|tablets?|capsules?)\b/i,
  /\bstop taking\b/i,
  /\bswitch (to|from) .* medicine\b/i,
  // Added while testing Clara's equivalency-explanation capability: the
  // existing patterns above were tuned against Alice's dosage-question
  // domain and didn't catch substitution-directive language, which is
  // exactly Clara's domain. Same heuristic, extended by a second real use
  // case rather than guessed in advance.
  /\byou should substitute\b/i,
  /\bshould be substituted\b/i,
  /\bi recommend substituting\b/i,
];

// Checked against the patient's own message, before any model call --
// catches an obvious clinical question early, cheaply, and without ever
// sending it to a non-clinical prompt.
export function detectsClinicalAdviceRequest(text: string): boolean {
  return CLINICAL_ADVICE_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

// Checked against the model's own response -- a second, independent check
// in case the prompt's instruction to refuse was not followed. A response
// that trips this is never returned to the patient; it is escalated
// instead (see alice.ts's respond()).
export function detectsClinicalDecisionLanguage(text: string): boolean {
  return CLINICAL_DECISION_LANGUAGE_PATTERNS.some((pattern) => pattern.test(text));
}

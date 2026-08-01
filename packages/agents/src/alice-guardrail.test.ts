import { describe, expect, it } from "vitest";
import { detectsClinicalAdviceRequest, detectsClinicalDecisionLanguage } from "./alice-guardrail";

describe("detectsClinicalAdviceRequest", () => {
  it.each([
    "Should I take ibuprofen with my blood pressure medicine?",
    "What dose of amoxicillin should I take?",
    "Is it safe to mix these two medicines?",
    "Can I take paracetamol with my other pills?",
    "Can you diagnose why I have a headache?",
    "What are the side effects of metformin?",
    "Which medicine should I use for a cough?",
    "How much aspirin should I take for a fever?",
  ])("flags a clinical-advice-seeking question: %s", (text) => {
    expect(detectsClinicalAdviceRequest(text)).toBe(true);
  });

  it.each([
    "How do I upload a prescription photo?",
    "What does 'pending pharmacist review' mean?",
    "Where can I see my order history?",
    "How long does delivery usually take?",
  ])("does not flag an ordinary platform question: %s", (text) => {
    expect(detectsClinicalAdviceRequest(text)).toBe(false);
  });
});

describe("detectsClinicalDecisionLanguage", () => {
  it.each([
    "You should take two tablets twice a day.",
    "I recommend taking this with food.",
    "Based on your diagnosis, this should help.",
    "Take 500 mg every eight hours.",
    "You should stop taking this medicine immediately.",
    "You could switch to a generic medicine instead.",
    "You should substitute this with the generic.",
    "This medicine should be substituted for the branded version.",
    "I recommend substituting this for a cheaper alternative.",
  ])("flags clinical-decision language in a response: %s", (text) => {
    expect(detectsClinicalDecisionLanguage(text)).toBe(true);
  });

  it.each([
    "Your prescription is currently awaiting pharmacist review.",
    "You can upload a new prescription from the home screen.",
    "A pharmacist will follow up with you shortly.",
  ])("does not flag an ordinary status response: %s", (text) => {
    expect(detectsClinicalDecisionLanguage(text)).toBe(false);
  });
});

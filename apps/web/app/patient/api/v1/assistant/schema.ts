import { z } from "zod";

export const askSchema = z.discriminatedUnion("capability", [
  z.object({
    capability: z.literal("answer_platform_question"),
    question: z.string().min(1).max(2000),
  }),
  z.object({
    capability: z.literal("guide_prescription_upload"),
    question: z.string().min(1).max(2000),
  }),
  z.object({
    capability: z.literal("explain_workflow_status"),
    question: z.string().min(1).max(2000),
    workflowStatus: z.string().min(1).max(100),
  }),
  z.object({
    capability: z.literal("collect_administrative_information"),
    question: z.string().min(1).max(2000),
  }),
]);

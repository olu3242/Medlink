import { AssistantApplication } from "../../../../lib/assistant";
import { runApi } from "../../../../lib/api-server";
import { askSchema } from "./schema";

// AG-02 -- Alice, the first real AI Gateway consumer. Every response is
// either a direct answer or an escalation record (see
// packages/agents/src/alice.ts); this route never returns raw clinical
// content, and never lets a patient's clinical question reach the model
// without a human eventually reviewing it.
export const POST = (request: Request) => runApi(request, {
  name: "assistant.ask",
  permission: "assistant:use",
  schema: askSchema,
  input: (value) => value.json(),
  execute: async (input, context, database) => new AssistantApplication(database).ask(context, input),
  success: (data) => Response.json({ data }, { status: 200 }),
});

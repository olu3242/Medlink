import { describe, expect, it } from "vitest";
import { HumanClinicalReviewRequiredError } from "./errors";
import type { MedicationAccessRequest } from "./models";
import { MarWorkflowService } from "./service";

const mar: MedicationAccessRequest = { id:"m",tenantId:"t",patientId:"p",prescriptionId:"rx",state:"validated",version:1,createdAt:new Date(0),updatedAt:new Date(0) };
function service() {
  let saved: MedicationAccessRequest | null = null; const events: unknown[] = [];
  return { events, value: new MarWorkflowService(
    { findById: async()=>mar, transitionAtomically:async(input)=>({...mar,state:input.state,version:2}) },
    { append: async(e)=>{events.push(e);} },
    { find:async()=>saved,record:async(_k,r)=>{saved=r;} },
    { next:()=>"event" }, { now:()=>new Date(1) },
  )};
}
describe("MAR workflow",()=>{
  it("requires a human pharmacist for review",async()=>{
    await expect(service().value.transition({marId:"m",tenantId:"t",to:"reviewed",expectedVersion:1,idempotencyKey:"k",actor:{kind:"system",service:"ai"}})).rejects.toBeInstanceOf(HumanClinicalReviewRequiredError);
  });
  it("is idempotent and audits once",async()=>{
    const x=service(); const command={marId:"m",tenantId:"t",to:"reviewed" as const,expectedVersion:1,idempotencyKey:"k",actor:{kind:"pharmacist" as const,userId:"u",licenseId:"lic"}};
    await x.value.transition(command); await x.value.transition(command); expect(x.events).toHaveLength(1);
  });
});

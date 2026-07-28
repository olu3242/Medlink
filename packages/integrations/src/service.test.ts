import{describe,expect,it}from"vitest";import{WebhookGuard}from"./service";
describe("webhooks",()=>{it("rejects replay",async()=>{const g=new WebhookGuard({verify:async()=>true},{claimOnce:async()=>false},()=>new Date(0));await expect(g.verify({body:new Uint8Array(),signature:"s",timestamp:new Date(0).toISOString(),eventId:"e"})).rejects.toMatchObject({code:"replayed_webhook"});});});

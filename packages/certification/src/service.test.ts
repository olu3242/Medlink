import{describe,expect,it}from"vitest";import{CertificationService}from"./service";
describe("certification",()=>{it("fails when any check fails",async()=>{const r=await new CertificationService().run([{id:"rls",description:"RLS",run:async()=>({passed:false,evidence:"failed"})}]);expect(r.passed).toBe(false);});});

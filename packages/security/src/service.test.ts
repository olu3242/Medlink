import{describe,expect,it}from"vitest";import{requireMfa,SecurityService}from"./service";
describe("security",()=>{it("enforces MFA",()=>{expect(()=>new SecurityService().enforce({tenantId:"t",userId:"u",roles:[],mfaVerified:false,authenticatedAt:new Date()},[requireMfa()])).toThrow();});});

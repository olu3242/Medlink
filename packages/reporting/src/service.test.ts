import{describe,expect,it}from"vitest";import{ReportingService}from"./service";
describe("reporting",()=>{it("suppresses identifying small cohorts",async()=>{const s=new ReportingService({read:async()=>[{bucket:"x",count:1,dimensions:{}}]},5);expect(await s.generate({tenantId:"t",report:"r",from:new Date(0),to:new Date(1)})).toEqual([]);});});

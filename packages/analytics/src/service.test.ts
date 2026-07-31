import{describe,expect,it}from"vitest";import{AnalyticsService}from"./service";
describe("analytics",()=>{it("suppresses small cohorts",async()=>{const s=new AnalyticsService({query:async()=>[{metric:"m",bucket:"b",count:2,dimensions:{}}]},5);expect(await s.query({tenantId:"t",metric:"m",from:new Date(0),to:new Date(1)})).toEqual([]);});});

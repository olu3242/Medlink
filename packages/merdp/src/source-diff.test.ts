import {describe,expect,it} from "vitest";
import {classifySourceSnapshot,routeSourceDrift} from "./source-diff";

describe("continuous MERDP source snapshot diff",()=>{
  it("classifies added, changed, missing and unchanged without deleting evidence",()=>{
    const result=classifySourceSnapshot({previous:[{id:"1",name:"A"},{id:"2",name:"B"},{id:"3",name:"C"}],current:[{id:"1",name:"A"},{id:"2",name:"B2"},{id:"4",name:"D"}],sourceId:"id",governedFields:["name"]});
    expect(result.map(({sourceId,state})=>({sourceId,state}))).toEqual([
      {sourceId:"1",state:"UNCHANGED"},{sourceId:"2",state:"CHANGED"},{sourceId:"3",state:"MISSING"},{sourceId:"4",state:"ADDED"}]);
    expect(result.find(row=>row.sourceId==="3")?.before).toEqual({id:"3",name:"C"});
  });
  it("is deterministic for reordered snapshots",()=>{
    const input={previous:[{id:"2",name:"B"},{id:"1",name:"A"}],current:[{id:"1",name:"A"},{id:"2",name:"B"}],sourceId:"id" as const,governedFields:["name"] as const};
    expect(classifySourceSnapshot(input).map(row=>row.sourceId)).toEqual(["1","2"]);
  });
  it("simulates continuous product and manufacturer refreshes",()=>{
    const products=classifySourceSnapshot({
      previous:[{id:"unchanged",name:"A",nrn:"N1"},{id:"changed",name:"B",nrn:"N2"},{id:"missing",name:"C",nrn:"N3"},{id:"off-list",name:"History",nrn:"N4"}],
      current:[{id:"unchanged",name:"A",nrn:"N1"},{id:"changed",name:"B2",nrn:"N2"},{id:"new",name:"D",nrn:"N5"},{id:"off-list",name:"History",nrn:"N4"}],sourceId:"id",governedFields:["name","nrn"]});
    expect(products.map(row=>row.state)).toEqual(["CHANGED","MISSING","ADDED","UNCHANGED","UNCHANGED"]);
    expect(routeSourceDrift({state:"ADDED",currentListed:true})).toBe("SAFE_AUTOMATION");
    expect(routeSourceDrift({state:"CHANGED",currentListed:true})).toBe("REVIEW_REQUIRED");
    expect(routeSourceDrift({state:"MISSING",currentListed:true})).toBe("REVIEW_REQUIRED");
    expect(routeSourceDrift({state:"UNCHANGED",currentListed:false})).toBe("EVIDENCE_ONLY");
    expect(routeSourceDrift({state:"CHANGED",currentListed:false,conflict:true})).toBe("CONFLICT");
    const manufacturers=classifySourceSnapshot({previous:[{id:"1",name:"Stable"},{id:"2",name:"Old"},{id:"3",name:"Missing"}],current:[{id:"1",name:"Stable"},{id:"2",name:"Renamed"},{id:"4",name:"New"}],sourceId:"id",governedFields:["name"]});
    expect(manufacturers.map(row=>row.state)).toEqual(["UNCHANGED","CHANGED","MISSING","ADDED"]);
  });
  it("routes an off-list identity becoming listed through governed new-product evaluation",()=>{
    const transition=classifySourceSnapshot({previous:[],current:[{id:"2087",name:"Historical evidence now listed"}],sourceId:"id",governedFields:["name"]})[0]!;
    expect(transition.state).toBe("ADDED");
    expect(routeSourceDrift({state:transition.state,currentListed:true})).toBe("SAFE_AUTOMATION");
  });
});

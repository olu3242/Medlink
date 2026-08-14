export type SourceDriftState = "ADDED" | "CHANGED" | "MISSING" | "UNCHANGED";
export type SourcePolicyRoute = "SAFE_AUTOMATION" | "REVIEW_REQUIRED" | "CONFLICT" | "EVIDENCE_ONLY";
export interface SourceDrift<T> { readonly sourceId:string; readonly state:SourceDriftState; readonly before?:T; readonly after?:T; readonly changedFields:readonly string[]; }

export function classifySourceSnapshot<T extends Readonly<Record<string,string>>>(input:{
  readonly previous:readonly T[]; readonly current:readonly T[]; readonly sourceId:keyof T & string; readonly governedFields:readonly (keyof T & string)[];
}):readonly SourceDrift<T>[] {
  const previous=new Map(input.previous.map(row=>[String(row[input.sourceId]??""),row]));
  const current=new Map(input.current.map(row=>[String(row[input.sourceId]??""),row]));
  const ids=[...new Set([...previous.keys(),...current.keys()])].sort();
  return ids.map(sourceId=>{
    const before=previous.get(sourceId),after=current.get(sourceId);
    if(!before) return {sourceId,state:"ADDED" as const,after:after!,changedFields:input.governedFields};
    if(!after) return {sourceId,state:"MISSING" as const,before,changedFields:[]};
    const changedFields=input.governedFields.filter(field=>before[field]!==after[field]);
    return {sourceId,state:changedFields.length?"CHANGED" as const:"UNCHANGED" as const,before,after,changedFields};
  });
}

export function routeSourceDrift(input:{readonly state:SourceDriftState;readonly currentListed:boolean;readonly conflict?:boolean}):SourcePolicyRoute {
  if(input.conflict) return "CONFLICT";
  if(!input.currentListed) return "EVIDENCE_ONLY";
  if(input.state==="ADDED") return "SAFE_AUTOMATION";
  if(input.state==="CHANGED"||input.state==="MISSING") return "REVIEW_REQUIRED";
  return "EVIDENCE_ONLY";
}

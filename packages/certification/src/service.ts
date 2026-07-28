export interface CertificationCheck{readonly id:string;readonly description:string;run():Promise<{readonly passed:boolean;readonly evidence:string}>;}
export interface CertificationResult{readonly passed:boolean;readonly checks:readonly {id:string;passed:boolean;evidence:string}[];}
export class CertificationService{async run(checks:readonly CertificationCheck[]):Promise<CertificationResult>{const results=await Promise.all(checks.map(async c=>({id:c.id,...await c.run()})));return{passed:results.length>0&&results.every(x=>x.passed),checks:results};}}

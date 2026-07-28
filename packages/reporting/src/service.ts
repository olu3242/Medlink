export interface ReportRow{readonly bucket:string;readonly count:number;readonly dimensions:Readonly<Record<string,string>>;}
export interface AggregateReportSource{read(input:{tenantId:string;report:string;from:Date;to:Date;minimumCohort:number}):Promise<readonly ReportRow[]>;}
export class ReportingService{constructor(private readonly source:AggregateReportSource,private readonly minimumCohort=10){}
 async generate(input:{tenantId:string;report:string;from:Date;to:Date}):Promise<readonly ReportRow[]>{const rows=await this.source.read({...input,minimumCohort:this.minimumCohort});return rows.filter(x=>x.count>=this.minimumCohort);}}

export interface AggregateMetric{readonly metric:string;readonly bucket:string;readonly count:number;readonly dimensions:Readonly<Record<string,string>>;}
export interface AggregateAnalyticsReader{query(input:{tenantId:string;metric:string;from:Date;to:Date;minimumCohortSize:number}):Promise<readonly AggregateMetric[]>;}
export class AnalyticsService{
 constructor(private readonly reader:AggregateAnalyticsReader,private readonly minimumCohortSize=10){}
 async query(input:{tenantId:string;metric:string;from:Date;to:Date}):Promise<readonly AggregateMetric[]>{if(input.to<=input.from)throw new Error("Invalid analytics range");const rows=await this.reader.query({...input,minimumCohortSize:this.minimumCohortSize});return rows.filter(x=>x.count>=this.minimumCohortSize);}
}

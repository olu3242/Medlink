import { Client } from "pg";

export interface Wave15JobOptions {
  readonly connectionString:string;
  readonly directorySha256:string;
  readonly relationshipsSha256:string;
  readonly failureStage?:"after_organizations"|"after_relationships";
  readonly enforceCertifiedBaseline?:boolean;
}

export type Wave15JobResult=Readonly<{
  durationMs:number;sourceScopedOrganizations:number;organizationDelta:number;
  manufacturerMappings:number;relationships:number;knownProducts:number;
  unknownProducts:number;conflicts:number;candidateFindings:number;
  certificationDelta:number;publicationDelta:number;
}>;

/** Execute bulk convergence in PostgreSQL's transaction boundary, not PostgREST. */
export async function runWave15ManufacturerJob(options:Wave15JobOptions):Promise<Wave15JobResult>{
  const client=new Client({connectionString:options.connectionString});
  await client.connect();
  try {
    await client.query("begin");
    const result=await client.query<{result:Wave15JobResult}>(
      "select public.run_merdp_wave15_manufacturer_convergence($1,$2,$3,$4) as result",
      [options.directorySha256,options.relationshipsSha256,options.failureStage??null,options.enforceCertifiedBaseline??true]
    );
    await client.query("commit");
    return result.rows[0]!.result;
  } catch(error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

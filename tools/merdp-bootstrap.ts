import { readFileSync } from "node:fs";
import { dirname,isAbsolute,resolve } from "node:path";
import { createClient,type SupabaseClient } from "@supabase/supabase-js";
import { applyBootstrap,bootstrapManifestSchema,SupabaseMerdpRepository,validateBootstrap,type TargetState } from "../packages/merdp/src/index";

type Arguments={manifest:string;environment:string;projectRef:string;mode:"dry-run"|"apply";allowProduction:boolean;approveDriftSha256?:string;authorizeBaselineSha256?:string};

function parseArguments(values:string[]):Arguments{
  const options=new Map<string,string>();let mode:Arguments["mode"]|undefined;let allowProduction=false;
  for(let index=0;index<values.length;index++){
    const value=values[index]!;
    if(value==="--dry-run"||value==="--apply"){if(mode)throw new Error("Choose exactly one of --dry-run or --apply");mode=value.slice(2) as Arguments["mode"];continue;}
    if(value==="--allow-production"){allowProduction=true;continue;}
    if(!value.startsWith("--"))throw new Error(`Unexpected argument: ${value}`);
    const next=values[++index];if(!next||next.startsWith("--"))throw new Error(`Missing value for ${value}`);options.set(value,next);
  }
  const manifest=options.get("--manifest"),environment=options.get("--environment"),projectRef=options.get("--project-ref");
  if(!manifest||!environment||!projectRef||!mode)throw new Error("Required: --manifest PATH --environment NAME --project-ref REF and exactly one of --dry-run/--apply");
  return {manifest:resolve(manifest),environment,projectRef,mode,allowProduction,approveDriftSha256:options.get("--approve-drift-sha256"),authorizeBaselineSha256:options.get("--authorize-baseline")};
}

function sourcePath(manifestPath:string,path:string):string{return isAbsolute(path)?path:resolve(dirname(manifestPath),path);}
function requireEnvironment(name:string):string{const value=process.env[name];if(!value)throw new Error(`Missing required environment variable: ${name}`);return value;}
function verifyTargetUrl(url:string,projectRef:string):void{
  const parsed=new URL(url);if(parsed.protocol!=="https:"||parsed.hostname!==`${projectRef}.supabase.co`)throw new Error("SUPABASE_URL_PROJECT_MISMATCH");
}
async function count(db:SupabaseClient,table:string):Promise<number>{const result=await db.from(table).select("*",{count:"exact",head:true});if(result.error)throw new Error(`TARGET_STATE_UNAVAILABLE:${table}:${result.error.message}`);return result.count??0;}
async function inspect(db:SupabaseClient):Promise<TargetState>{
  const [medicines,manufacturers,registrations,rawRecords]=await Promise.all([count(db,"medicines"),count(db,"merdp_manufacturer_identities"),count(db,"medicine_registrations"),count(db,"etl_source_records")]);
  return {medicines,manufacturers,registrations,rawRecords};
}

async function main():Promise<void>{
  const args=parseArguments(process.argv.slice(2));
  const manifest=bootstrapManifestSchema.parse(JSON.parse(readFileSync(args.manifest,"utf8")));
  const url=process.env.MEDLINK_MERDP_SUPABASE_URL??(args.mode==="dry-run"?process.env.NEXT_PUBLIC_SUPABASE_URL:undefined)??requireEnvironment("MEDLINK_MERDP_SUPABASE_URL");
  const serviceRoleKey=process.env.MEDLINK_MERDP_SUPABASE_SERVICE_ROLE_KEY??(args.mode==="dry-run"?process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY:undefined)??requireEnvironment("MEDLINK_MERDP_SUPABASE_SERVICE_ROLE_KEY");
  verifyTargetUrl(url,args.projectRef);
  const db=createClient(url,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}}),before=await inspect(db);
  const validated=validateBootstrap({manifest,sources:{products:readFileSync(sourcePath(args.manifest,manifest.sources.products.path),"utf8"),manufacturers:readFileSync(sourcePath(args.manifest,manifest.sources.manufacturers.path),"utf8")},mode:args.mode,projectRef:args.projectRef,environment:args.environment,targetState:before,approveDriftSha256:args.approveDriftSha256,authorizeBaselineSha256:args.authorizeBaselineSha256,allowProduction:args.allowProduction,productionAuthorization:process.env.MEDLINK_MERDP_PRODUCTION_AUTHORIZATION});
  if(args.mode==="dry-run"){
    console.log(JSON.stringify({status:"DRY_RUN_COMPLETE",mutations:0,targetBefore:before,plan:validated.plan},null,2));return;
  }
  const result=await applyBootstrap(validated,new SupabaseMerdpRepository(db)),after=await inspect(db);
  console.log(JSON.stringify({status:"APPLY_COMPLETE",targetBefore:before,targetAfter:after,result},null,2));
}

main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});

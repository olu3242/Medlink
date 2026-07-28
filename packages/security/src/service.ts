export interface SecurityContext{readonly tenantId:string;readonly userId:string;readonly roles:readonly string[];readonly mfaVerified:boolean;readonly authenticatedAt:Date;}
export interface SecurityPolicy{readonly name:string;evaluate(context:SecurityContext):boolean;}
export class SecurityPolicyError extends Error{readonly code="security_policy_denied";constructor(readonly policy:string){super(`Security policy '${policy}' denied access`);this.name=new.target.name;}}
export class SecurityService{enforce(context:SecurityContext,policies:readonly SecurityPolicy[]):void{for(const policy of policies)if(!policy.evaluate(context))throw new SecurityPolicyError(policy.name);}}
export function requireMfa():SecurityPolicy{return{name:"mfa_required",evaluate:ctx=>ctx.mfaVerified};}
export function requireRecentAuthentication(now:Date,maxAgeMs:number):SecurityPolicy{return{name:"recent_authentication",evaluate:ctx=>now.valueOf()-ctx.authenticatedAt.valueOf()<=maxAgeMs};}

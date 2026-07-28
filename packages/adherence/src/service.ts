export interface AdherenceSchedule{readonly id:string;readonly tenantId:string;readonly patientId:string;readonly medicineId:string;readonly timezone:string;readonly times:readonly string[];readonly startsOn:string;readonly endsOn?:string;}
export interface AdherenceEvent{readonly id:string;readonly scheduleId:string;readonly patientId:string;readonly scheduledFor:Date;readonly recordedAt:Date;readonly outcome:"taken"|"missed"|"skipped";}
export interface AdherenceRepository{saveSchedule(value:AdherenceSchedule):Promise<AdherenceSchedule>;findEventByKey(key:string):Promise<AdherenceEvent|null>;saveEvent(value:AdherenceEvent,key:string):Promise<AdherenceEvent>;}
export class AdherenceError extends Error{readonly code="invalid_adherence_schedule";}
export class AdherenceService{
 constructor(private readonly repo:AdherenceRepository,private readonly id:()=>string,private readonly now:()=>Date){}
 createSchedule(input:Omit<AdherenceSchedule,"id">):Promise<AdherenceSchedule>{if(input.times.length===0||input.times.some(x=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(x)))throw new AdherenceError("Schedule requires valid local times");return this.repo.saveSchedule({...input,id:this.id()});}
 async record(input:Omit<AdherenceEvent,"id"|"recordedAt">,key:string):Promise<AdherenceEvent>{const prior=await this.repo.findEventByKey(key);if(prior)return prior;return this.repo.saveEvent({...input,id:this.id(),recordedAt:this.now()},key);}
}

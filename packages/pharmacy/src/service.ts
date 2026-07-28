import {InvalidDiscoveryRadiusError} from "./errors"; import type {Coordinates,PharmacyMatch} from "./models"; import type {PharmacyReader,PharmacyStockReader} from "./ports";
function distanceKm(a:Coordinates,b:Coordinates):number{const r=6371,dLat=(b.latitude-a.latitude)*Math.PI/180,dLon=(b.longitude-a.longitude)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a.latitude*Math.PI/180)*Math.cos(b.latitude*Math.PI/180)*Math.sin(dLon/2)**2;return 2*r*Math.asin(Math.sqrt(x));}
export class PharmacyDiscoveryService {
 constructor(private readonly pharmacies:PharmacyReader,private readonly stock:PharmacyStockReader){}
 async discover(input:{tenantId:string;medicineId:string;origin:Coordinates;radiusKm:number}):Promise<readonly PharmacyMatch[]>{
  if(input.radiusKm<1||input.radiusKm>200)throw new InvalidDiscoveryRadiusError();
  const rows=(await this.pharmacies.findNear(input)).filter(p=>p.active);
  const matches=await Promise.all(rows.map(async pharmacy=>{const distance=distanceKm(input.origin,pharmacy.location);const confidence=Math.max(0,Math.min(1,await this.stock.confidence(pharmacy.id,input.medicineId)));return {pharmacy,distanceKm:distance,stockConfidence:confidence,score:confidence*.7+(1-Math.min(distance/input.radiusKm,1))*.25+(pharmacy.open24Hours?.05:0)};}));
  return matches.filter(x=>x.distanceKm<=input.radiusKm).sort((a,b)=>b.score-a.score||a.distanceKm-b.distanceKm);
 }
}

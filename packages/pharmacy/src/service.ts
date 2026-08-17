import {InvalidDiscoveryRadiusError,LocationConsentRequiredError} from "./errors"; import type {Coordinates,Pharmacy,PharmacyMatch} from "./models"; import type {PharmacyReader,PharmacyStockReader} from "./ports";
export function distanceKm(a:Coordinates,b:Coordinates):number{const r=6371,dLat=(b.latitude-a.latitude)*Math.PI/180,dLon=(b.longitude-a.longitude)*Math.PI/180;const x=Math.sin(dLat/2)**2+Math.cos(a.latitude*Math.PI/180)*Math.cos(b.latitude*Math.PI/180)*Math.sin(dLon/2)**2;return 2*r*Math.asin(Math.sqrt(x));}
export class PharmacyDiscoveryService {
 constructor(private readonly pharmacies:PharmacyReader,private readonly stock:PharmacyStockReader){}
 async discover(input:{tenantId:string;medicineId:string;origin:Coordinates;radiusKm:number}):Promise<readonly PharmacyMatch[]>{
  if(input.radiusKm<1||input.radiusKm>200)throw new InvalidDiscoveryRadiusError();
  const rows=(await this.pharmacies.findNear(input)).filter(p=>p.active);
  const matches=await Promise.all(rows.map(async pharmacy=>{const distance=distanceKm(input.origin,pharmacy.location);const confidence=Math.max(0,Math.min(1,await this.stock.confidence(pharmacy.id,input.medicineId)));return {pharmacy,distanceKm:distance,stockConfidence:confidence,score:confidence*.7+(1-Math.min(distance/input.radiusKm,1))*.25+(pharmacy.open24Hours?.05:0)};}));
  return matches.filter(x=>x.distanceKm<=input.radiusKm).sort((a,b)=>b.score-a.score||a.distanceKm-b.distanceKm);
 }
}

export interface EligibleInventory {
 readonly inventoryId:string; readonly pharmacyLocationId:string;
 readonly medicineId:string; readonly medicineName:string; readonly expiresOn:string;
 readonly availableQuantity:number; readonly state:string; readonly observedAt:string;
 readonly unitPriceMinor:number|null; readonly currencyCode:string|null;
}
export interface EligiblePharmacyLocation extends Pharmacy { readonly updatedAt:string; }
export interface EligiblePharmacyResult {
 readonly pharmacy:EligiblePharmacyLocation; readonly distanceKm:number;
 readonly inventory:EligibleInventory;
}

export function findEligiblePharmacies(input:{
 readonly tenantId:string; readonly medicineId:string; readonly origin:Coordinates;
 readonly radiusKm:number; readonly locationConsent:boolean;
 readonly locations:readonly EligiblePharmacyLocation[];
 readonly inventory:readonly EligibleInventory[];
}):readonly EligiblePharmacyResult[]{
 if(!input.locationConsent)throw new LocationConsentRequiredError();
 if(input.radiusKm<1||input.radiusKm>200)throw new InvalidDiscoveryRadiusError();
 const today=new Date().toISOString().slice(0,10);
 return input.locations
  .filter(location=>location.tenantId===input.tenantId&&location.active)
  .map(pharmacy=>{
   const distance=distanceKm(input.origin,pharmacy.location);
   const inventory=input.inventory
    .filter(batch=>batch.pharmacyLocationId===pharmacy.id
      &&batch.medicineId===input.medicineId
      &&batch.availableQuantity>0&&batch.expiresOn>=today
      &&["in_stock","low_stock"].includes(batch.state))
    .sort((left,right)=>left.expiresOn.localeCompare(right.expiresOn)
      ||left.inventoryId.localeCompare(right.inventoryId))[0];
   return inventory?{pharmacy,distanceKm:distance,inventory}:null;
  })
  .filter((result):result is EligiblePharmacyResult=>Boolean(result&&result.distanceKm<=input.radiusKm))
  .sort((left,right)=>left.distanceKm-right.distanceKm
    ||left.inventory.expiresOn.localeCompare(right.inventory.expiresOn));
}

export interface Coordinates {readonly latitude:number;readonly longitude:number;}
export interface Pharmacy {readonly id:string;readonly tenantId:string;readonly name:string;readonly location:Coordinates;readonly active:boolean;readonly open24Hours:boolean;}
export interface PharmacyMatch {readonly pharmacy:Pharmacy;readonly distanceKm:number;readonly stockConfidence:number;readonly score:number;}

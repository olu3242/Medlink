import Link from "next/link";
import { gatewayData } from "../../../lib/api/client";

interface Mar {
  id: string;
  medicineName: string;
  status: string;
  createdAt: string;
  pharmacyName?: string;
}

export default async function PatientHome() {
  let items: Mar[] = [];
  let failed = false;
  try {
    items = await gatewayData<Mar[]>("/api/v1/mar");
  } catch {
    failed = true;
  }
  return <main><header><p>Medication access</p><h1>My requests</h1><p>Track reviews, matches, and reservations.</p><Link href="/patient/search">Find medicine</Link></header>{failed ? <p role="alert">Requests are temporarily unavailable. Try again shortly.</p> : <section>{items.length ? items.map((item) => <article key={item.id}><p>{item.status}</p><h2>{item.medicineName}</h2><p>{item.pharmacyName ?? "Pharmacy matching in progress"}</p><Link href={`/patient/mar/${item.id}`}>View request</Link></article>) : <article><h2>No active requests</h2><p>Search for a medicine to start a medication access request.</p></article>}</section>}</main>;
}

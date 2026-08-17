"use client";import {Button} from "@medlink/ui";import Link from "next/link";import {useParams,useSearchParams} from "next/navigation";import {useState} from "react";
// POST /api/v1/reservations requires marId/pharmacyLocationId/
// inventoryBatchId/quantity/idempotencyKey/expiresAt -- this page
// previously sent only {inventoryId}, which always failed schema
// validation, so no browser reservation could ever succeed. marId and
// pharmacyLocationId now arrive as query params carried forward from the
// MAR page through search (see app/search/page.tsx); inventoryId doubles
// as inventoryBatchId (inventory_batches IS the searchable inventory
// item). quantity is fixed at 1 -- neither the MAR nor the inventory
// result carries a requested quantity today, and a single-package fill
// is the only case this UI supports. expiresAt is a 24h hold, computed
// client-side since there is no server-side default.
export default function Reserve(){const {inventoryId}=useParams<{inventoryId:string}>();const searchParams=useSearchParams();const marId=searchParams.get("marId");const pharmacyLocationId=searchParams.get("pharmacyLocationId");const[message,setMessage]=useState("");const[busy,setBusy]=useState(false);async function submit(){if(!marId||!pharmacyLocationId){setMessage("This reservation is missing its medication request context. Start from your request instead.");return}setBusy(true);setMessage("");try{const r=await fetch("/api/v1/reservations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({marId,pharmacyLocationId,inventoryBatchId:inventoryId,quantity:1,idempotencyKey:`reservation:${marId}:${inventoryId}`,expiresAt:new Date(Date.now()+24*60*60*1000).toISOString()})});if(!r.ok)throw new Error();setMessage("Reservation requested. The pharmacy will confirm availability.")}catch{setMessage("The reservation could not be requested. Please try again.")}finally{setBusy(false)}}return <><header className="head"><div><div className="eyebrow">Reservation</div><h1>Review your request</h1></div><Link className="secondary" href="/search">Back to results</Link></header><section className="card"><h2>Before you reserve</h2><p>This request does not guarantee stock until the pharmacy confirms it. A pharmacist must approve any clinical substitution.</p><div className="actions"><Button disabled={busy} onClick={submit}>{busy?"Requesting…":"Request reservation"}</Button><span aria-live="polite">{message}</span></div></section></>}

import Link from "next/link";
import { gatewayData } from "../../../../lib/api/client";

interface Match {
  inventoryId: string;
  inventoryBatchId: string;
  pharmacyLocationId: string;
  availableQuantity: number;
  pharmacyName: string;
  pharmacyLocality?: string;
  medicineName: string;
  stockStatus: string;
}
interface Mar { id: string; medicineName: string; status: string }

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; marId?: string }>;
}) {
  const { q = "", marId = "" } = await searchParams;
  let matches: Match[] = [];
  let matchedMars: Mar[] = [];
  let failed = false;
  try {
    matchedMars = (await gatewayData<Mar[]>("/api/v1/mar"))
      .filter((mar) => mar.status === "matched");
    if (q && marId) {
      matches = await gatewayData<Match[]>(`/api/v1/inventory?q=${encodeURIComponent(q)}`);
    }
  } catch {
    failed = true;
  }
  return <main><header><p>Medicine search</p><h1>Find medicine nearby</h1><p>Select the matched medication request that this reservation will fulfill.</p></header>{matchedMars.length ? <form method="get"><label htmlFor="marId">Matched request</label><select id="marId" name="marId" defaultValue={marId} required><option value="" disabled>Select a request</option>{matchedMars.map((mar) => <option key={mar.id} value={mar.id}>{mar.medicineName}</option>)}</select><label htmlFor="q">Brand or generic medicine</label><input id="q" name="q" defaultValue={q} required placeholder="e.g. metformin 500 mg"/><button type="submit">Search availability</button></form> : <p>No medication request is ready for reservation. A request must complete matching first.</p>}{failed ? <p role="alert">Search is temporarily unavailable.</p> : q && marId ? <section aria-label="Search results">{matches.length ? matches.map((match) => <article key={match.inventoryId}><p>{match.stockStatus}</p><h2>{match.medicineName}</h2><p>{match.pharmacyName}</p><p>{match.pharmacyLocality ?? "Location unavailable"}</p><p>{match.availableQuantity} currently available</p><Link href={{pathname:`/patient/reserve/${match.inventoryBatchId}`,query:{marId,pharmacyLocationId:match.pharmacyLocationId,maxQuantity:String(match.availableQuantity)}}}>Review reservation</Link></article>) : <article><h2>No nearby matches</h2><p>Try a generic name or wider search area.</p></article>}</section> : null}</main>;
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ReservationForm } from "./reservation-form";

const inputSchema = z.object({
  inventoryBatchId: z.string().uuid(),
  marId: z.string().uuid(),
  pharmacyLocationId: z.string().uuid(),
  maxQuantity: z.coerce.number().int().positive(),
});

export default async function ReservePage({
  params,
  searchParams,
}: {
  params: Promise<{ inventoryBatchId: string }>;
  searchParams: Promise<{ marId?: string; pharmacyLocationId?: string; maxQuantity?: string }>;
}) {
  const parsed = inputSchema.safeParse({ ...await params, ...await searchParams });
  if (!parsed.success) notFound();
  const configured = Number.parseInt(process.env.MEDLINK_RESERVATION_WINDOW_MINUTES ?? "30", 10);
  const windowMinutes = Number.isFinite(configured) && configured >= 5 && configured <= 1440
    ? configured : 30;
  const expiresAt = new Date(Date.now() + windowMinutes * 60_000).toISOString();
  return <main><header><p>Reservation</p><h1>Review your request</h1><Link href="/patient/search">Back to results</Link></header><ReservationForm {...parsed.data} expiresAt={expiresAt}/></main>;
}

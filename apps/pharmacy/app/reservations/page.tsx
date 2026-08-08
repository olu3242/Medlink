import { redirect } from "next/navigation";

export default function RetiredLegacyReservationQueue() {
  redirect("/pharmacy/reservations");
}

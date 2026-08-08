import { redirect } from "next/navigation";

export default function RetiredLegacyReservationPage() {
  redirect("/patient/search");
}

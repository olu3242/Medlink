import Link from "next/link";

export default function PharmacyHome() {
  return <main><h1>Pharmacy operations</h1><p>Manage canonical reservation and fulfillment work.</p><Link href="/pharmacy/reservations">Open reservation queue</Link></main>;
}

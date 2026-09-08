import { AuthenticatedShell } from "../../components/authenticated-shell";

export default function PharmacyLayout({ children }: { children: import("react").ReactNode }) {
  return <AuthenticatedShell portal="pharmacy">{children}</AuthenticatedShell>;
}

import { AuthenticatedShell } from "../../components/authenticated-shell";

export default function PharmacistLayout({ children }: { children: import("react").ReactNode }) {
  return <AuthenticatedShell portal="pharmacist">{children}</AuthenticatedShell>;
}

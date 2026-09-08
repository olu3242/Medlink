import { AuthenticatedShell } from "../../components/authenticated-shell";

export default function PatientLayout({ children }: { children: import("react").ReactNode }) {
  return <AuthenticatedShell portal="patient">{children}</AuthenticatedShell>;
}

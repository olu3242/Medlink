import { AuthenticatedShell } from "../../components/authenticated-shell";

export default function AdminLayout({ children }: { children: import("react").ReactNode }) {
  return <AuthenticatedShell portal="admin">{children}</AuthenticatedShell>;
}

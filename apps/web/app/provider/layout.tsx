import { AuthenticatedShell } from "../../components/authenticated-shell";

export default function ProviderLayout({ children }: { children: import("react").ReactNode }) {
  return <AuthenticatedShell portal="provider">{children}</AuthenticatedShell>;
}

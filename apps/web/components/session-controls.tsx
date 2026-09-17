"use client";
import { useEffect, useState } from "react";
import { endSession } from "../app/auth/sign-in/actions";

export function SessionControls() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("medlink-auth") : null;
    if (channel) channel.onmessage = (event) => {
      if (event.data === "signed-out") window.location.replace("/auth/sign-in?signed_out=true");
      if (event.data === "workspace-changed") window.location.reload();
    };
    const verify = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/auth/session", { cache: "no-store" });
        if (response.status === 401) window.location.replace(`/auth/sign-in?error=session_expired&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        else if (response.status === 403) window.location.replace("/auth/workspaces?error=permission_denied");
      } catch { setError("Session could not be checked. Refresh to retry."); }
    };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", verify);
    const timer = window.setInterval(verify, 60000);
    return () => { channel?.close(); window.clearInterval(timer); window.removeEventListener("pageshow", restore); window.removeEventListener("focus", verify); document.removeEventListener("visibilitychange", verify); };
  }, []);
  return <div><button className="ml-logout" type="button" disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try {
      if (!await endSession()) throw new Error();
      const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("medlink-auth") : null;
      channel?.postMessage("signed-out"); channel?.close();
      // Full navigation destroys React's patient/catalogue/reservation caches.
      window.location.replace("/auth/sign-in?signed_out=true");
    } catch { setError("Could not confirm sign-out. Please retry."); setBusy(false); }
  }}>{busy ? "Signing out…" : "Log out"}</button>{error && <p role="alert">{error}</p>}</div>;
}

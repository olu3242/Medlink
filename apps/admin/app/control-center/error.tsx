"use client";

import { useEffect } from "react";

export default function ControlCenterError({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => { /* Error details remain in the framework's server telemetry. */ }, [error]);
  return <section className="card error-state" role="alert">
    <h1>Control Center unavailable</h1>
    <p>A safe recovery is available. No dashboard data was changed.</p>
    {error.digest ? <p><small>Request reference: {error.digest}</small></p> : null}
    <button type="button" onClick={reset}>Retry</button>
  </section>;
}

"use client";
import { useState } from "react";
import { authClient } from "./auth-client";
export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return <div className="sign-out"><button className="quiet-button" disabled={pending} onClick={async () => {
    if (pending) return;
    setPending(true); setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) { setError(true); setPending(false); return; }
      // Full navigation clears authenticated server-component/router state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/sign-in");
    } catch { setError(true); setPending(false); }
  }}>{pending ? "Signing out…" : "Sign out"}</button>{error && <p role="alert">Could not sign out. Please retry.</p>}</div>;
}

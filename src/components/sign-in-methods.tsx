"use client";
import { useState } from "react";
import { authClient } from "./auth-client";
import { googleAuthMessage } from "./google-auth-messages";
import type { SignInMethods } from "@/server/sign-in-methods";

export function AuthenticationMethods({ methods, configured, linked }: { methods: SignInMethods; configured: boolean; linked: boolean }) {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  async function link() {
    setPending(true); setError("");
    try {
      const result = await authClient.linkSocial({ provider: "google", callbackURL: "/settings/account?google=linked", errorCallbackURL: "/sign-in" });
      if (!result.error) return;
      setError(googleAuthMessage(result.error.code?.toLowerCase()));
    } catch { setError(googleAuthMessage(null)); }
    setPending(false);
  }
  async function unlink() {
    if (!methods.google || !methods.passwordAvailable) return;
    setPending(true); setError("");
    try {
      const result = await authClient.unlinkAccount({ accountId: methods.google.id });
      if (!result.error) {
        // Clear cached account methods at the authentication boundary.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/settings/account"); return;
      }
      setError("Google could not be unlinked. Sign in again with your password and retry.");
    } catch { setError("Google could not be unlinked. Please retry."); }
    setPending(false);
  }
  return <section className="authentication-methods" aria-labelledby="sign-in-methods-title">
    <h3 id="sign-in-methods-title">Sign-in methods</h3><p>How you access your One Better account. Google Calendar is a separate connection under Integrations.</p>
    {linked && methods.google && <p className="authentication-notice" role="status">Google sign-in linked. Your existing workspace is unchanged.</p>}
    <div className="authentication-method"><div><strong>Google</strong><p>{methods.google ? `Connected as ${methods.google.email}` : configured ? "Not linked" : "Not configured yet"}</p></div>{methods.google ? methods.passwordAvailable ? <button className="quiet-button" disabled={pending} onClick={() => void unlink()}>Unlink Google</button> : <span className="small-note">Your only sign-in method</span> : <button className="quiet-button" disabled={pending || !configured} onClick={() => void link()}>{pending ? "Continuing…" : "Link Google"}</button>}</div>
    <div className="authentication-method"><div><strong>Password</strong><p>{methods.passwordAvailable ? "Available" : "Not available"}</p></div></div>
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>;
}

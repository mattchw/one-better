"use client";
import { useState, type FormEvent } from "react";
import { authClient } from "./auth-client";
import { googleAuthMessage } from "./google-auth-messages";

export function SignInForm({ googleConfigured = false, initialError = "" }: { googleConfigured?: boolean; initialError?: string }) {
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState(initialError);
  async function google() {
    if (pending) return;
    setPending(true); setGooglePending(true); setError("");
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/calendar", errorCallbackURL: "/sign-in" });
      if (!result.error) return;
      setError(googleAuthMessage(result.error.code?.toLowerCase()));
    } catch { setError(googleAuthMessage(null)); }
    setPending(false); setGooglePending(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      const result = await authClient.signIn.email({ email: String(fields.get("email")).trim(), password: String(fields.get("password")) });
      if (result.error) {
        setError(result.error.status >= 500 ? "Cannot reach your account. Please retry." : "Sign-in failed. Check your email and password.");
        setPending(false); return;
      }
      // Clear the prior account's router state on an authentication boundary.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch { setError("Cannot reach your account. Please retry."); setPending(false); }
  }
  return <form onSubmit={submit} className="auth-form">
    <button type="button" className="google-auth-button" disabled={pending || !googleConfigured} onClick={() => void google()}><span className="google-auth-mark" aria-hidden="true">G</span>{googlePending ? "Continuing with Google…" : "Continue with Google"}</button>
    <p className="google-auth-caption">{googleConfigured ? "Sign in to One Better. Calendar access is connected separately." : "Google sign-in isn’t configured yet. Use your password below."}</p>
    <div className="auth-divider"><span>or use your password</span></div>
    <label htmlFor="email">Email</label>
    <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} aria-describedby={error ? "sign-in-error" : undefined} />
    <label htmlFor="password">Password</label>
    <input id="password" name="password" type="password" autoComplete="current-password" required aria-describedby={error ? "sign-in-error" : undefined} />
    {error && <p id="sign-in-error" role="alert" className="error-message">{error}</p>}
    <button type="submit" disabled={pending} className="primary-button">{pending && !googlePending ? "Signing in…" : "Sign in"}<span aria-hidden="true">↗</span></button>
  </form>;
}

import { SignInForm } from "@/components/sign-in-form";
import Link from "next/link";
import { readGoogleAuthConfiguration } from "@/server/google-auth-config";
import { googleAuthMessage } from "@/components/google-auth-messages";
export const dynamic = "force-dynamic";
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <main className="sign-in-page">
    <section className="introduction"><Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">↗</span> One Better</Link>
      <div><p className="eyebrow">A little intention. Meaningful progress.</p><h1>Make room for<br />what matters.</h1><p className="intro-copy">Choose a direction. Give it time.<br />Learn from the week you actually lived.</p></div>
      <p className="loop-caption">Goals <span>→</span> Plan <span>→</span> Focus <span>→</span> Review</p>
    </section>
    <section className="sign-in-panel" aria-labelledby="sign-in-title"><div className="auth-card">
      <p className="eyebrow">Your workspace</p><h2 id="sign-in-title">Welcome to One Better.</h2><p className="muted">Sign in or create your account with Google.</p><SignInForm googleConfigured={!!readGoogleAuthConfiguration(process.env)} initialError={query.error ? googleAuthMessage(query.error) : ""}/>
      <p className="small-note">New here? Continue with Google to create your account. Password sign-in is available for existing accounts.</p>
    </div></section>
  </main>;
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { runtime } from "@/server/runtime";
import { ApplicationError } from "@/domain/errors";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext, type AccountContext } from "@/modules/account/service";
import { SettingsFrame } from "@/components/settings-frame";
import { SignOutButton } from "@/components/sign-out-button";
import { AuthenticationMethods } from "@/components/sign-in-methods";
import { readSignInMethods, type SignInMethods } from "@/server/sign-in-methods";
import { readGoogleAuthConfiguration } from "@/server/google-auth-config";
export const dynamic = "force-dynamic";

export default async function AccountSettings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let account: AccountContext, methods: SignInMethods;
  const query = await searchParams;
  try { account = await readAccountContext(await requireActor(await headers()), accountRepository(runtime().db)); methods = await readSignInMethods(runtime().db, account.id, account.email); }
  catch (error) {
    if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    return <main className="recovery"><h1>Account could not be loaded.</h1><p role="alert">Check the database connection and retry.</p><a href="/settings/account">Retry account settings</a></main>;
  }
  const initials = account.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return <SettingsFrame section="account" accountName={account.name}>
    <section className="account-settings" aria-labelledby="account-title">
      <div className="settings-intro"><h2 id="account-title">Account</h2><p>Your profile and the time zone behind your plan.</p></div>
      <div className="settings-profile"><span className="settings-profile-avatar" aria-hidden="true">{initials}</span><div><strong>{account.name}</strong><p>{account.email}</p></div></div>
      <dl className="settings-account-facts"><div><dt>Display name</dt><dd>{account.name}</dd></div><div><dt>Time zone</dt><dd>{account.timezone}</dd></div><div><dt>Email</dt><dd>{account.email}</dd></div></dl>
      <p className="small-note">These are your saved account details. Your time zone determines local calendar days, weekly boundaries and recurring focusable hours.</p>
      <AuthenticationMethods methods={methods} configured={!!readGoogleAuthConfiguration(process.env)} linked={query.google === "linked"}/>
      <div className="settings-account-action"><div><h3>Sign out</h3><p>Your goals, plans and reviews stay saved.</p></div><SignOutButton /></div>
    </section>
  </SettingsFrame>;
}

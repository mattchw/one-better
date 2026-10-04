import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { hours } from "@/server/availability";
import { ApplicationError } from "@/domain/errors";
import { FocusableHoursSettings } from "@/components/focusable-hours-settings";
import { SettingsFrame } from "@/components/settings-frame";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext } from "@/modules/account/service";
import { runtime } from "@/server/runtime";
export const dynamic = "force-dynamic";
export default async function AvailabilitySettings() {
  let settings, account;
  try { const actor = await requireActor(await headers()); [settings, account] = await Promise.all([hours().settings(actor), readAccountContext(actor, accountRepository(runtime().db))]); }
  catch (error) { if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") redirect("/sign-in"); return <main className="recovery"><h1>Focusable Hours could not be loaded.</h1><p role="alert">Check the database connection and retry. Your saved hours remain unchanged.</p><a href="/availability">Retry settings</a></main>; }
  return <SettingsFrame section="availability" accountName={account.name}><FocusableHoursSettings initial={settings} /></SettingsFrame>;
}

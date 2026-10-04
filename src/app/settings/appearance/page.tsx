import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { runtime } from "@/server/runtime";
import { ApplicationError } from "@/domain/errors";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext } from "@/modules/account/service";
import { SettingsFrame } from "@/components/settings-frame";
import { AppearanceSettings } from "@/components/appearance-settings";

export const dynamic = "force-dynamic";
export default async function AppearancePage() {
  let account;
  try { account = await readAccountContext(await requireActor(await headers()), accountRepository(runtime().db)); }
  catch (error) {
    if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    return <main className="recovery"><h1>Appearance could not be loaded.</h1><p role="alert">Check the connection and retry.</p><a href="/settings/appearance">Retry appearance settings</a></main>;
  }
  return <SettingsFrame section="appearance" accountName={account.name}><AppearanceSettings/></SettingsFrame>;
}

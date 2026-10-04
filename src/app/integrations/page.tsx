import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { calendar } from "@/server/calendar";
import { ApplicationError } from "@/domain/errors";
import type { CalendarWorkspace } from "@/modules/calendar/domain";
import { CalendarSettings } from "@/components/calendar-settings";
import { SettingsFrame } from "@/components/settings-frame";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext } from "@/modules/account/service";
import { ChatGPTSettings } from "@/components/chatgpt-settings";
import { chatGPT, chatGPTConfiguration } from "@/server/chatgpt";
import type { ChatGPTWorkspace } from "@/modules/chatgpt/domain";
import { runtime } from "@/server/runtime";
export const dynamic = "force-dynamic";
export default async function Integrations({ searchParams }: { searchParams: Promise<{ calendar?: string; chatgpt?:string }> }) {
  let initial: CalendarWorkspace, account; let ai:ChatGPTWorkspace={configured:false,connections:[]};
  try { const actor = await requireActor(await headers()); [initial, account] = await Promise.all([calendar().workspace(actor), readAccountContext(actor, accountRepository(runtime().db))]); if(chatGPTConfiguration())ai=await chatGPT().workspace(actor); }
  catch (error) { if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") redirect("/sign-in"); return <main className="recovery"><h1>Integrations could not be loaded.</h1><p role="alert">{error instanceof ApplicationError ? error.message : "Check the connection and retry."}</p><a className="primary-button" href="/integrations">Retry Integrations</a><Link href="/planning">Weekly planning</Link></main>; }
  const params=await searchParams,callback=params.calendar;
  return <SettingsFrame section="integrations" accountName={account.name}><CalendarSettings initial={initial} callback={["success", "cancelled", "failed"].includes(callback ?? "") ? callback : undefined} /><ChatGPTSettings initial={ai} callback={params.chatgpt}/></SettingsFrame>;
}

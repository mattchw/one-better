import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { ApplicationError } from "@/domain/errors";
import { focus } from "@/server/focus";
import type { FocusWorkspace } from "@/modules/focus/domain";
import { FocusView } from "@/components/focus-view";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext, type AccountContext } from "@/modules/account/service";
import { runtime } from "@/server/runtime";
export const dynamic="force-dynamic";
export default async function FocusPage({searchParams}:{searchParams:Promise<{block?:string}>}){
 let account:AccountContext; let initial:FocusWorkspace;const selected=(await searchParams).block;
 try{const actor=await requireActor(await headers());[initial,account]=await Promise.all([focus().workspace(actor,selected),readAccountContext(actor,accountRepository(runtime().db))]);}catch(error){if(error instanceof ApplicationError&&error.code==="UNAUTHENTICATED")redirect("/sign-in");return <main className="recovery"><h1>Focus could not be loaded.</h1><p role="alert">{error instanceof ApplicationError&&["NOT_FOUND","VALIDATION"].includes(error.code)?error.message:"Check the database connection and retry. Your saved session remains recoverable."}</p><a className="primary-button" href="/focus">Retry focus</a></main>;}
 return <FocusView initial={initial} selected={selected} accountName={account.name}/>;
}

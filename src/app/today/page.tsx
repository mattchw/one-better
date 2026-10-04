import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { ApplicationError } from "@/domain/errors";
import { reviews } from "@/server/reviews";
import type { DailyExecution } from "@/modules/reviews/domain";
import { DailyExecutionView } from "@/components/daily-execution-view";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext, type AccountContext } from "@/modules/account/service";
import { runtime } from "@/server/runtime";
import { AppHeader } from "@/components/app-header";
export const dynamic = "force-dynamic";
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  let account:AccountContext; let initial: DailyExecution; const date = (await searchParams).date;
  try { const actor=await requireActor(await headers());[initial,account]=await Promise.all([reviews().day(actor,date),readAccountContext(actor,accountRepository(runtime().db))]); }
  catch (error) { if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") redirect("/sign-in"); return <main className="recovery"><h1>Daily execution could not be loaded.</h1><p role="alert">{error instanceof ApplicationError && error.code === "VALIDATION" ? error.message : "Check the database connection and retry. Saved reflections remain recoverable."}</p><a className="primary-button" href="/today">Retry daily execution</a></main>; }
  // Full navigation preserves the browser beforeunload guard for unsaved reflection text.
  return <div className="workspace daily-page"><a className="skip-link" href="#main">Skip to content</a><AppHeader section="review" accountName={account.name} /><main id="main" className="workspace-main"><DailyExecutionView key={initial.localDate} initial={initial}/></main></div>;
}

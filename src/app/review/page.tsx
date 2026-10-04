import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { ApplicationError } from "@/domain/errors";
import { weeklyReviews } from "@/server/weekly-reviews";
import { WeeklyReviewView } from "@/components/weekly-review-view";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext, type AccountContext } from "@/modules/account/service";
import { runtime } from "@/server/runtime";
import { AppHeader } from "@/components/app-header";
export const dynamic = "force-dynamic";
export default async function ReviewPage({searchParams}:{searchParams:Promise<{week?:string}>}) {
  let account:AccountContext; let initial;
  try {const actor=await requireActor(await headers());[initial,account]=await Promise.all([weeklyReviews().workspace(actor,(await searchParams).week),readAccountContext(actor,accountRepository(runtime().db))]);}
  catch(error){if(error instanceof ApplicationError&&error.code==="UNAUTHENTICATED")redirect("/sign-in");return <main className="recovery"><h1>Weekly review could not be loaded.</h1><p role="alert">{error instanceof ApplicationError&&error.code==="VALIDATION"?error.message:"Check the database connection and retry. Saved reviews remain recoverable."}</p><a href="/review" className="primary-button">Retry weekly review</a></main>;}
  // Full navigation preserves the native unsaved-note guard.
  return <div className="workspace review-page"><a className="skip-link" href="#main">Skip to content</a><AppHeader section="review" accountName={account.name} /><main id="main" className="workspace-main"><WeeklyReviewView key={initial.weekStartDate} initial={initial}/></main></div>;
}

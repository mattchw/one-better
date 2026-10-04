import {focusCycles} from '@/server/focus-cycles';
import type {CycleWorkspace} from '@/modules/focus-cycles/domain';
import { weeklyReviews } from "@/server/weekly-reviews";
import type { CarryIntent } from "@/modules/weekly-reviews/domain";
import type { WeekWorkspace, PlanningSource } from "@/modules/planning/domain";
import { amendments } from "@/server/amendments";
import type { AmendmentHistory } from "@/modules/amendments/domain";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { ApplicationError } from "@/domain/errors";
import { PlanningView } from "@/components/planning-view";
import { AppHeader } from "@/components/app-header";
import { planning } from "@/server/planning";
export const dynamic = "force-dynamic";
export default async function WeeklyPlanning({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  let cycles:CycleWorkspace;
  let initialCarries: CarryIntent[];
  let initialHistory: AmendmentHistory | undefined;
  let workspace: WeekWorkspace; let candidates: PlanningSource[];
  try {
    const actor = await requireActor(await headers()); const service = planning();
    cycles=await focusCycles().workspace(actor);
    workspace = await service.workspace(actor, (await searchParams).week);
    initialCarries = await weeklyReviews().carries(actor,workspace.weekStartDate);
    if (workspace.view?.plan.state === "committed") initialHistory = await amendments().history(actor, workspace.view.plan.id);
    candidates = workspace.view?.plan.state === "committed" || !workspace.canCreate && !workspace.view ? [] : await service.candidates(actor);

  } catch (error) {
    if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    return <main className="recovery"><h1>Planning could not be loaded.</h1><p role="alert">{error instanceof ApplicationError && error.code === "VALIDATION" ? error.message : "Check the database connection and retry. Your saved plans remain unchanged."}</p><a href="/planning" className="primary-button">Retry current week</a></main>;
  }
    return <div className="workspace"><a className="skip-link" href="#main">Skip to content</a><AppHeader section="calendar" /><main id="main" className="workspace-main"><PlanningView key={workspace.weekStartDate} initialCycles={cycles} initialWorkspace={workspace} initialCandidates={candidates} initialHistory={initialHistory} initialCarries={initialCarries} /></main><footer className="workspace-footer">Make under-committing easy.<span>Leave room for ordinary life</span></footer></div>;
}

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ApplicationError } from "@/domain/errors";
import { requireActor } from "@/server/actor";
import { goals } from "@/server/goals";
import { milestones } from "@/server/milestones";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext } from "@/modules/account/service";
import { runtime } from "@/server/runtime";
import { AppHeader } from "@/components/app-header";
import { GoalWorkView } from "@/components/goal-work-view";
import { weekSchema } from "@/modules/planning/domain";
import { goalWeek } from "@/server/goal-week";
import { actions } from "@/server/actions";
export const dynamic = "force-dynamic";
export default async function GoalDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; actionView?: string; week?: string }> }) {
  const { id } = await params; const { view, actionView, week } = await searchParams;
  if (week && !weekSchema.safeParse(week).success) return <main className="recovery"><h1>Choose a Monday-start week.</h1><Link href={`/goals/${id}`}>Return to the current week</Link></main>;
  let data;
  try {
    const actor = await requireActor(await headers());
    data = { week: await goalWeek(actor, week), goal: await goals().getGoal(actor, id), milestones: await milestones().listMilestones(actor, id), actions: await actions().listActions(actor, id), navigation: await goals().listGoals(actor, "active"), account: await readAccountContext(actor, accountRepository(runtime().db)) };
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error instanceof ApplicationError && ["NOT_FOUND", "VALIDATION"].includes(error.code)) notFound();
    return <main className="recovery"><h1>Let’s reconnect.</h1><p role="alert">This goal and its milestones and actions could not be loaded. Please retry.</p><Link className="primary-button" href={`/goals/${id}`}>Retry</Link></main>;
  }
  return <div className="workspace goals-page"><a className="skip-link" href="#main">Skip to content</a><AppHeader section="goals" accountName={data.account.name} /><main id="main" className="workspace-main"><GoalWorkView navigation={data.goal.archivedAt ? [data.goal, ...data.navigation] : data.navigation} goal={data.goal} milestones={data.milestones} milestoneState={view === "completed" || view === "archived" ? view : "active"} catalog={data.actions} actionState={actionView === "completed" || actionView === "archived" ? actionView : "open"} timezone={data.account.timezone} initialWeek={data.week} /></main><footer className="workspace-footer">Keep the evidence in view.</footer></div>;
}

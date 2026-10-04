import {focusCycles} from '@/server/focus-cycles';
import type {CycleWorkspace} from '@/modules/focus-cycles/domain';
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { runtime } from "@/server/runtime";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext, type AccountContext } from "@/modules/account/service";
import { ApplicationError } from "@/domain/errors";
import { GoalsView } from "@/components/goals-view";
import { goals } from "@/server/goals";
import type { Goal } from "@/modules/goals/domain";
import { milestones } from "@/server/milestones";
import { actions } from "@/server/actions";
import { goalWeek } from "@/server/goal-week";
import type { GoalInsight } from "@/components/goals-view";
import type { GoalWeek } from "@/components/goal-week";
import { AppHeader } from "@/components/app-header";
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const status = (await searchParams).view === "archived" ? "archived" : "active";
  let account: AccountContext;
  let activeGoals: Goal[];
  let insights: Record<string, GoalInsight>;
  let week: GoalWeek;
  let cycles: CycleWorkspace;
  try {
    const actor = await requireActor(await headers());
    account = await readAccountContext(actor, accountRepository(runtime().db));
    activeGoals = await goals().listGoals(actor, status);
    cycles = await focusCycles().workspace(actor);
    [week, insights] = await Promise.all([goalWeek(actor), Promise.all(activeGoals.map(async goal => [goal.id, { milestones: await milestones().listMilestones(actor, goal.id), catalog: await actions().listActions(actor, goal.id) }] as const)).then(Object.fromEntries)]);
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    // A full document retry bypasses a potentially cached client-router error.
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    return <main className="recovery"><p className="eyebrow">One Better</p><h1>Let’s reconnect.</h1><p role="alert">Your workspace could not be loaded. Check the database connection and retry.</p><a className="primary-button" href="/goals">Retry</a></main>;
  }
  return <div className="workspace goals-page">
    <a className="skip-link" href="#main">Skip to content</a>
    <AppHeader section="goals" accountName={account.name} />
    <main id="main" className="workspace-main">
      <GoalsView initialGoals={activeGoals} initialStatus={status} initialInsights={insights} initialWeek={week} initialCycles={cycles} />
    </main><footer className="workspace-footer">Make under-committing easy.<span>Outcomes before activity</span></footer>
  </div>;
}

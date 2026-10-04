import type { EffectivePlan, AmendmentHistory } from "@/modules/amendments/domain";
import type { WeekWorkspace, PlanningSnapshot } from "@/modules/planning/domain";
import { request } from "./mutation-client";
export type GoalWeek = { workspace: WeekWorkspace; effective: EffectivePlan | null };
export function weekWork({ workspace, effective }: GoalWeek): { actionId: string; budgetMinutes: number; context: PlanningSnapshot | null }[] {
  const view = workspace.view;
  if (!view) return [];
  if (view.plan.state === "committed") return effective?.commitments.map(c => ({ ...c, context: c.snapshot })) ?? [];
  return view.plan.commitments.map(c => ({ ...c, context: view.sources.find(s => s.actionId === c.actionId)?.context ?? null }));
}
export async function readGoalWeek(week?: string): Promise<GoalWeek> {
  const workspace = await request<WeekWorkspace>(`/api/weekly-plans${week ? `?week=${encodeURIComponent(week)}` : ""}`);
  const effective = workspace.view?.plan.state === "committed" ? (await request<AmendmentHistory>(`/api/weekly-plans/${workspace.view.plan.id}/amendments`)).effective : null;
  return { workspace, effective };
}

import "server-only";
import type { Actor } from "@/domain/actor";
import type { GoalWeek } from "@/components/goal-week";
import { planning } from "./planning";
import { amendments } from "./amendments";
export async function goalWeek(actor: Actor, week?: string): Promise<GoalWeek> {
  const workspace = await planning().workspace(actor, week);
  const effective = workspace.view?.plan.state === "committed" ? (await amendments().history(actor, workspace.view.plan.id)).effective : null;
  return { workspace, effective };
}

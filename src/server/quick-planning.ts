import 'server-only';
import { goals } from './goals';
import type { Actor } from '../domain/actor';
import { planning } from './planning';
import { hours, focusAvailability } from './availability';
import { readCalendarProjection } from '../modules/scheduling/calendar-reader';
import { runtime } from './runtime';
import type { FocusWorkspace } from '../modules/availability/service';
import { unfinishedWeekTasks } from '../modules/planning/unfinished';
export async function quickPlanningContext(actor: Actor, week?: string) {
  const workspace = await planning().workspace(actor, week);
  const candidates = await planning().candidates(actor);
  let context: FocusWorkspace | null = null;
  try { context = await focusAvailability().read(actor, workspace.weekStartDate); } catch { /* Manual planning remains available. */ }
  const occupied = (await readCalendarProjection(runtime().db, actor, workspace.weekStartDate, 'week', workspace.timezone)).blocks;
  const ownedGoals = await goals().listGoals(actor,'active');
  const sparePercent = (await hours().settings(actor)).schedule?.sparePercent ?? 25;
  const unfinished = await unfinishedWeekTasks(runtime().db,actor,workspace.weekStartDate,candidates);
  return { sparePercent, workspace, candidates, unfinished, context, occupied, hasGoals: ownedGoals.length > 0, now: Date.now() };
}

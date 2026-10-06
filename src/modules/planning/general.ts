import type { Goal } from '../goals/domain';
type GoalContext = Pick<Goal, 'id' | 'title' | 'outcome'> | null | undefined;
// Old auto-created containers remain only as immutable historical context.
export const legacyGeneralOutcome = 'Make progress on the tasks I choose for my weekly plans.';
export const isLegacyGeneralGoal = (goal: GoalContext) => goal?.title === 'Weekly priorities' && goal.outcome === legacyGeneralOutcome;
export const goalGroupKey = (goal: GoalContext) => !goal || isLegacyGeneralGoal(goal) ? 'general' : goal.id;
export const goalTitle = (goal: GoalContext) => !goal || isLegacyGeneralGoal(goal) ? 'General' : goal.title;

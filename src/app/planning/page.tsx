import { redirect } from 'next/navigation';
import { weekSchema } from '@/modules/planning/domain';
export default async function PlanningPage({searchParams}:{searchParams:Promise<{week?:string}>}) {
 const {week}=await searchParams;
 redirect(week&&weekSchema.safeParse(week).success?`/calendar?week=${week}`:'/calendar');
}

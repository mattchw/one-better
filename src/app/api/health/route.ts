import { runtime } from "@/server/runtime";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await runtime().pool.query('SELECT 1 FROM app_user LEFT JOIN goal ON false LEFT JOIN mutation_receipt ON false LEFT JOIN milestone ON false LEFT JOIN action ON false LEFT JOIN weekly_plan ON false LEFT JOIN weekly_commitment ON false LEFT JOIN weekly_plan_amendment ON false LEFT JOIN amendment_commitment ON false LEFT JOIN google_calendar_connection ON false LEFT JOIN calendar_oauth_flow ON false LEFT JOIN calendar_availability_cache ON false LEFT JOIN focusable_hours ON false LEFT JOIN commitment_identity ON false LEFT JOIN time_block ON false LEFT JOIN focus_session ON false LEFT JOIN daily_reflection ON false LEFT JOIN weekly_review ON false LEFT JOIN weekly_review_decision ON false LEFT JOIN focus_cycle ON false LEFT JOIN focus_cycle_goal ON false LEFT JOIN ai_recommendation_run ON false LIMIT 1');
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

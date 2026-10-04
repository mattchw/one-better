import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: { searchParams: Promise<{ view?: string; week?: string }> }) {
  const { view, week } = await searchParams;
  // Preserve old active/archived Goals bookmarks after changing the home surface.
  if (view) redirect(`/goals?view=${encodeURIComponent(view)}`);
  redirect(week ? `/calendar?week=${encodeURIComponent(week)}` : "/calendar");
}

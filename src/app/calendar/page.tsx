import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { ApplicationError } from "@/domain/errors";
import { calendarInitial } from "@/server/calendar-workspace";
import { AppHeader } from "@/components/app-header";
import { CalendarWorkspace } from "@/components/calendar-workspace";
export const dynamic = "force-dynamic";
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string;view?:string;date?:string }> }) {
  let initial;
  try {
    const actor = await requireActor(await headers());
    initial = await calendarInitial(actor,await searchParams);
  } catch(error) {
    if(error instanceof ApplicationError && error.code === 'UNAUTHENTICATED') redirect('/sign-in');
    return <main className="recovery"><h1>Calendar could not be loaded.</h1><p role="alert">{error instanceof ApplicationError && error.code==='VALIDATION'?error.message:'Check the database connection and retry. Your saved work remains unchanged.'}</p><a className="primary-button" href="/calendar">Retry current week</a></main>;
  }
  return <div className="workspace calendar-page"><a className="skip-link" href="#main">Skip to content</a><AppHeader section="calendar" accountName={initial.accountName}/><main id="main" className="calendar-main"><CalendarWorkspace key={`${initial.selection.scale}-${initial.selection.date}`} initial={initial}/></main></div>;
}

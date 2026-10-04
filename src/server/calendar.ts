import "server-only";
import { executionClock } from "./execution-clock";
import { calendarRepository } from "../modules/calendar/repository";
import { calendarService } from "../modules/calendar/service";
import { googleCalendarProvider } from "../providers/google/calendar";
import { runtime } from "./runtime";
import { readConfiguration } from "./config";
import { readCalendarConfiguration } from "./calendar-config";
export function calendar() {
  const configuration = readCalendarConfiguration(process.env, readConfiguration(process.env).BETTER_AUTH_URL);
  const { db, pool } = runtime();
  return calendarService(calendarRepository(db, pool), configuration ? googleCalendarProvider(configuration.google) : null, configuration?.cipher ?? null,()=>new Date(executionClock()));
}

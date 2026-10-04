import type { BusyInterval, Calendar, CalendarFailure } from "./domain";
export class ProviderFailure extends Error { constructor(public readonly kind: CalendarFailure) { super("Calendar provider request failed."); } }
// Server-internal credentials: never a transport DTO or a planning input.
export type Credentials = { accessToken: string; refreshToken: string | null; expiresAt: number; scopes: string[]; accountId: string | null };
export interface CalendarAvailabilityProvider {
  authorization(state: string): Promise<{ url: string; verifier: string }>;
  exchange(code: string, verifier: string): Promise<Credentials>;
  refresh(refreshToken: string): Promise<Credentials>;
  revoke(token: string): Promise<void>;
  listCalendars(accessToken: string): Promise<Calendar[]>;
  queryBusyIntervals(accessToken: string, calendarIds: string[], range: BusyInterval): Promise<BusyInterval[]>;
}

import "server-only";
import { executionClock } from "./execution-clock";
import { hoursRepository } from "../modules/availability/repository";
import { hoursService, focusAvailabilityService } from "../modules/availability/service";
import { calendar } from "./calendar";
import { runtime } from "./runtime";
export const hours = () => hoursService(hoursRepository(runtime().db),executionClock);
export const focusAvailability = () => focusAvailabilityService(hours(), calendar(),()=>Date.parse(executionClock()));

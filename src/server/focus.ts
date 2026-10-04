import "server-only";
import { runtime } from "./runtime";
import { executionClock } from "./execution-clock";
import { focusRepository } from "../modules/focus/repository";
import { focusService } from "../modules/focus/service";
export const focus=()=>focusService(focusRepository(runtime().db),executionClock);

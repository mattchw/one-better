import "server-only";
import { executionClock } from "./execution-clock";
import { runtime } from "./runtime";
import { schedulingRepository } from "../modules/scheduling/repository";
import { schedulingService } from "../modules/scheduling/service";
export const scheduling = () => schedulingService(schedulingRepository(runtime().db,()=>new Date(executionClock())),executionClock);

import "server-only";
import { planService } from "../modules/planning/service";
import { planRepository } from "../modules/planning/repository";
import { runtime } from "./runtime";
export const planning = () => planService(planRepository(runtime().db));

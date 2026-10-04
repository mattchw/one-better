import "server-only";
import { milestoneRepository } from "../modules/milestones/repository";
import { milestoneService } from "../modules/milestones/service";
import { runtime } from "./runtime";
export const milestones = () => milestoneService(milestoneRepository(runtime().db));

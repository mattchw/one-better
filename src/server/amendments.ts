import "server-only";
import { amendmentRepository } from "../modules/amendments/repository";
import { amendmentService } from "../modules/amendments/service";
import { runtime } from "./runtime";
export const amendments = () => amendmentService(amendmentRepository(runtime().db));

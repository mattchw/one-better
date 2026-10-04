import "server-only";
import { actionService } from "../modules/actions/service";
import { actionRepository } from "../modules/actions/repository";
import { runtime } from "./runtime";
export const actions = () => actionService(actionRepository(runtime().db));

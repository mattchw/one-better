import "server-only";
import { runtime } from "./runtime";
import { executionClock } from "./execution-clock";
import { reviewRepository } from "../modules/reviews/repository";
import { reviewService } from "../modules/reviews/service";
export const reviews = () => reviewService(reviewRepository(runtime().db), executionClock);

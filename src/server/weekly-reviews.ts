import "server-only";
import { runtime } from "./runtime";
import { executionClock } from "./execution-clock";
import { weeklyReviewRepository } from "../modules/weekly-reviews/repository";
import { weeklyReviewService } from "../modules/weekly-reviews/service";
export const weeklyReviews = () => weeklyReviewService(weeklyReviewRepository(runtime().db),executionClock);

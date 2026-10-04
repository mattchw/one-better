import { runtime } from "@/server/runtime";
import { errorResponse } from "@/server/http-errors";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try { return await runtime().auth.handler(request); }
  catch (error) { return errorResponse(error); }
}
export { handle as GET, handle as POST };

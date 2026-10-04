import { requireActor } from "@/server/actor";
import { runtime } from "@/server/runtime";
import { errorResponse } from "@/server/http-errors";
import { accountRepository } from "@/modules/account/repository";
import { readAccountContext } from "@/modules/account/service";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request.headers);
    const user = await readAccountContext(actor, accountRepository(runtime().db));
    return Response.json({ user }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}

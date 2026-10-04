import { requireActor } from "@/server/actor";
import { calendar } from "@/server/calendar";
import { readConfiguration } from "@/server/config";
import { ApplicationError } from "@/domain/errors";
export async function GET(request: Request) {
  // Never render or log the callback query (code, state, raw provider error).
  // Every outcome redirects immediately to a clean local URL with no referrer.
  const origin = new URL(readConfiguration(process.env).BETTER_AUTH_URL).origin;
  let result = "failed";
  try {
    const actor = await requireActor(request.headers); const url = new URL(request.url);
    // Next normalizes Request.url to localhost in the loopback runtime. The
    // configured redirect used in authorization AND exchange stays exact;
    // validate the incoming Host instead of accepting normalized URL aliases.
    if (request.headers.get("host") === new URL(origin).host && url.searchParams.getAll("state").length === 1 && url.searchParams.getAll("code").length <= 1) result = await calendar().callback(actor, { state: url.searchParams.get("state"), code: url.searchParams.get("code"), denied: url.searchParams.has("error") });
  } catch (error) { console.error(JSON.stringify({ code: error instanceof ApplicationError ? error.code : "CALENDAR_CALLBACK_FAILED" })); }
  return new Response(null, { status: 303, headers: { Location: `${origin}/integrations?calendar=${result}`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}

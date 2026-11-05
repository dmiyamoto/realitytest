import { sessionIdFromRequest } from "@/lib/server/session";
import { getJobForSession, toPublicJob } from "@/lib/server/jobs";
import { errorJson, json } from "@/lib/server/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const job = await getJobForSession(id, sessionIdFromRequest(req));
  // Same 404 for "missing" and "belongs to another session": no existence oracle.
  if (!job) return errorJson(404, "not_found", "Evaluation not found.");
  return json(toPublicJob(job));
}

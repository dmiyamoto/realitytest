import { ensureSession, withCookie } from "@/lib/server/session";
import { createEvaluationJob, JobInputError } from "@/lib/server/jobs";
import { errorJson, json } from "@/lib/server/http";

/** Create an evaluation job (multipart form). Processing happens in the worker. */
export async function POST(req: Request): Promise<Response> {
  const { id: sessionId, setCookie } = await ensureSession(req);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return withCookie(errorJson(400, "invalid_form", "Expected multipart/form-data."), setCookie);
  }
  const fields: Record<string, unknown> = {};
  for (const k of ["source", "objectPrompt", "targetLabel", "targetZone", "mode", "zoneConfirmed"]) {
    const v = form.get(k);
    if (typeof v === "string") fields[k] = v;
  }
  const file = form.get("file");
  try {
    const { id, created } = await createEvaluationJob({
      sessionId,
      idempotencyKey: req.headers.get("idempotency-key"),
      fields,
      file: file instanceof File ? file : null,
    });
    return withCookie(json({ id, created }, { status: created ? 201 : 200 }), setCookie);
  } catch (err) {
    if (err instanceof JobInputError) return withCookie(errorJson(err.status, err.code, err.message), setCookie);
    console.error("[api/evaluations] create failed:", (err as Error).message);
    return withCookie(errorJson(500, "internal", "Could not create the evaluation."), setCookie);
  }
}

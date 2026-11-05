import { ensureSession, withCookie } from "@/lib/server/session";
import { sessionSummary } from "@/lib/server/jobs";
import { json } from "@/lib/server/http";
import { prisma } from "@/lib/server/db";
import { listFixturePrompts } from "@/lib/server/fixtures";

/** Current guest session: credits, free allowance, latest checkout status. */
export async function GET(req: Request): Promise<Response> {
  const { id, setCookie } = await ensureSession(req);
  const summary = await sessionSummary(id);
  const url = new URL(req.url);
  const cs = url.searchParams.get("checkout");
  const checkout = cs
    ? await prisma.checkoutRecord.findFirst({ where: { id: cs, sessionId: id }, select: { id: true, status: true } })
    : null;
  return withCookie(json({ ...summary, checkout, fixtures: listFixturePrompts() }), setCookie);
}

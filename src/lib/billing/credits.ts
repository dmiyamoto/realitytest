/**
 * Credit ledger. Balance = SUM(delta). Uniqueness constraints in the schema
 * make grants and debits idempotent:
 *   - one purchase grant per Stripe Checkout Session (stripeCheckoutId @unique)
 *   - one debit and one refund per job (@@unique([jobId, reason]))
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../server/db";

export const PACK20_CREDITS = 20;

type Tx = Prisma.TransactionClient;

export async function getBalance(sessionId: string, tx: Tx = prisma): Promise<number> {
  const agg = await tx.creditLedger.aggregate({ where: { sessionId }, _sum: { delta: true } });
  return agg._sum.delta ?? 0;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Grant credits for a paid Checkout Session. Returns false if already granted. */
export async function grantPurchase(tx: Tx, sessionId: string, checkoutId: string, credits = PACK20_CREDITS): Promise<boolean> {
  const existing = await tx.creditLedger.findUnique({ where: { stripeCheckoutId: checkoutId } });
  if (existing) return false;
  await tx.creditLedger.create({
    data: { sessionId, delta: credits, reason: "stripe_purchase", stripeCheckoutId: checkoutId },
  });
  return true;
}

/**
 * Debit one credit for a job inside a transaction. Throws InsufficientCredits.
 * Idempotent: a second debit for the same job is a no-op.
 */
export class InsufficientCreditsError extends Error {
  readonly code = "insufficient_credits";
}

export async function debitForJob(tx: Tx, sessionId: string, jobId: string): Promise<void> {
  const already = await tx.creditLedger.findFirst({ where: { jobId, reason: "evaluation_debit" } });
  if (already) return;
  const balance = await getBalance(sessionId, tx);
  if (balance < 1) throw new InsufficientCreditsError("No evaluation credits left.");
  await tx.creditLedger.create({ data: { sessionId, delta: -1, reason: "evaluation_debit", jobId } });
}

/** Refund a job's debit (e.g. when the Meta API failed). Idempotent. */
export async function refundJob(sessionId: string, jobId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const debit = await tx.creditLedger.findFirst({ where: { jobId, reason: "evaluation_debit" } });
    if (!debit) return false;
    const refunded = await tx.creditLedger.findFirst({ where: { jobId, reason: "evaluation_refund" } });
    if (refunded) return false;
    await tx.creditLedger.create({ data: { sessionId, delta: 1, reason: "evaluation_refund", jobId } });
    return true;
  });
}

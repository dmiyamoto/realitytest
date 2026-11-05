# Architecture

## Overview

```
Browser ──HTTP──► Next.js (App Router, Node runtime, persistent process)
                    │  /api/evaluations      create job (multipart upload, validation, billing)
                    │  /api/evaluations/:id  poll job (session-scoped)
                    │  /api/evaluations/:id/video  private video stream (Range)
                    │  /api/checkout         Stripe Checkout Session (TEST)          ┐ only when
                    │  /api/stripe/webhook   raw-body signature verification → credits ┘ BILLING_ENABLED=true
                    ▼
                 SQLite (Prisma)  ◄──────────  Worker (persistent Node process, `pnpm worker`)
                    ▲                              │ claim pending job atomically
                    │                              │ upload video → Meta Model API (sam-3.1)
                 local storage (uploads)  ◄────────┤ stream until response.completed
                                                   │ @meta-sam/parser → normalizer
                                                   │ deterministic evaluator → result
```

Long video inference runs in a **dedicated worker process**, not in a request handler or an edge
function. The web app only creates jobs and reads them.

## Modules

| Path | Responsibility |
|---|---|
| `src/lib/meta/sam.ts` | Meta Model API client: file upload, streaming Responses request, timeout/abort, error mapping |
| `src/lib/meta/normalizer.ts` | `@meta-sam/parser` result → `Observation[]` (frame index from markers, object IDs verbatim, mask centroid). Also replays recorded fixtures |
| `src/lib/evaluation/geometry.ts` | Mask centroid, point-in-polygon, polygon validity, letterbox-aware display↔source mapping |
| `src/lib/evaluation/evaluator.ts` | Verdict rules (PASS / FAIL / INCONCLUSIVE) and limitations |
| `src/lib/evaluation/pipeline.ts` | Tracking → verdict; an incomplete stream is never evaluated |
| `src/lib/media/{probe,validation}.ts` | ffprobe, container/codec/duration/size checks on the actual bytes |
| `src/lib/server/jobs.ts` | Job creation (idempotency key, free allowance, credit debit in one transaction), session-scoped access |
| `src/lib/server/session.ts` | HMAC-signed HttpOnly guest cookie |
| `src/lib/billing/{flag,credits,stripe}.ts` | `BILLING_ENABLED` flag (off by default); append-only credit ledger; Stripe Checkout and webhook processing |
| `src/worker/` | Atomic claim, stale-job recovery, processing, refunds on API failure |
| `src/components/` | Zone editor (draw rect/polygon), evidence player (canvas overlays + timeline) |

## Data model (`prisma/schema.prisma`)

- `EvaluationJob`: status, progress, mode (`live` | `fixture`), provenance, prompts, target
  zone (JSON, source px), video info, tracking (JSON), result (JSON), verdict, error, billing,
  attempts, worker ID, timestamps. `@@unique([sessionId, idempotencyKey])` makes retries
  idempotent.
- `CreditLedger`: append-only; balance = Σ delta. `stripeCheckoutId @unique` means one grant per
  Checkout Session. `@@unique([jobId, reason])` means one debit and one refund per job.
- `StripeEvent`: processed event IDs. It is inserted in the **same transaction** as the grant, so
  a replay is a no-op and a crash before commit lets Stripe retry safely.
- `CheckoutRecord`: Checkout Session status, for display only.

## Verdict rules

For the single tracked object, each observed frame's mask centroid is tested against the polygon.

1. No usable detection → `INCONCLUSIVE (INC_NO_DETECTIONS)`
2. Another object ID present in ≥ 50% as many frames, or co-occurring in the final frames →
   `INCONCLUSIVE (INC_AMBIGUOUS_OBJECTS)`
3. Coverage (observed frames / total frames) < threshold (default 0.6) → `INC_LOW_COVERAGE`
4. Fewer than 3 final observations, or the final observations end before 80% of the clip →
   `INC_MISSING_FINAL_OBSERVATIONS` (occlusion, out of view)
5. ≥ 3 of the last 5 inside: `PASS` if the object was seen outside earlier, otherwise
   `INC_NEVER_OBSERVED_OUTSIDE`
6. ≥ 3 of the last 5 visibly outside → `FAIL`
7. Otherwise → `INC_SPLIT_FINAL_VOTE`

API errors, timeouts, refusals and incomplete streams → `INCONCLUSIVE` (`INC_API_FAILURE` /
`INC_STREAM_INCOMPLETE`), with the credit refunded.

## Security model (TEST-MODE demo)

- Guest session = random 144-bit ID + HMAC-SHA256 signature in an HttpOnly, SameSite=Lax cookie
  (Secure when served over HTTPS).
- Jobs and private videos are returned only to the owning session. Other sessions get the same
  404 as a missing ID.
- Free live inference is limited per session (`FREE_EVALUATIONS_PER_SESSION`) and per day
  globally (`MAX_LIVE_EVALUATIONS_PER_DAY`). At most 2 active jobs per session.
- Uploads are capped at 25 MB / 12 s and validated with ffprobe. Rejected files are deleted.
- Billing off (default): Stripe routes return 404 and past the per-session cap a live run gets
  429 `free_limit_reached`. No credit is ever debited.
- Stripe (when enabled): test keys only; raw-body signature verification; grants only for `payment_status =
  paid` on `checkout.session.completed` / `checkout.session.async_payment_succeeded`.

## Limits of this MVP (production would need)

- **SQLite + local disk**: a single node only. Production needs Postgres, object storage (S3/GCS)
  with signed URLs, and a real queue (SQS, Cloud Tasks, BullMQ) instead of DB polling.
- **Guest sessions are not accounts**: anyone holding the cookie owns the credits, and clearing
  cookies loses them. Live billing requires real authentication, account recovery, receipts,
  refunds handling, and abuse protection.
- **No per-IP rate limiting / CAPTCHA**: add one before exposing free live inference publicly.
- **Single worker loop**: scale-out needs per-worker leases (the claim logic already supports
  several workers on one DB) and observability.
- **Video retention**: uploads are kept indefinitely. Add a retention policy and deletion API.
- **2D only**: no camera calibration, depth or multi-view reasoning.

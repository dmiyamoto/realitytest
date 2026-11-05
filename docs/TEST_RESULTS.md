# Test results

Run on 2026-11-05 (JST), macOS, Node 26.5.0, pnpm 10.34.5, ffmpeg 8.1.2.

| Command | Result |
|---|---|
| `pnpm lint` | ✅ 0 problems |
| `pnpm typecheck` | ✅ 0 errors |
| `pnpm test` | ✅ **54 passed / 0 failed** (8 files) |
| `pnpm build` | ✅ success, 0 warnings |
| `pnpm test:e2e` | ✅ **9 passed / 0 failed** (1 skipped: the opt-in screenshot capture) |
| `docker build` + run | ✅ web serves `/`, `/evaluate`, `/pricing`, `/api/session` (200). Worker process starts in the image |

## Required scenarios → tests

| # | Scenario | Where |
|---|---|---|
| 1 | Successful movement into target → PASS | `tests/unit/evaluator.test.ts` "1. PASS…", worker test in `api-jobs.test.ts`, E2E "results page shows PASS evidence" |
| 2 | Object remains outside → FAIL | `evaluator.test.ts` "2. FAIL…", E2E FAIL |
| 3 | Object disappears before final frames → INCONCLUSIVE | `evaluator.test.ts` "3. …", E2E INCONCLUSIVE |
| 4 | No SAM detections | `evaluator.test.ts` "4. …", `normalizer.test.ts` empty output |
| 5 | Multiple ambiguous detections | `evaluator.test.ts` "5. …" (+ brief spurious detection is *not* ambiguous) |
| 6 | Sparse / non-contiguous frames | `evaluator.test.ts` "6. …", `normalizer.test.ts` "6. preserves sparse, out-of-order frame indices" (real wire format via `@meta-sam/parser`) |
| 7 | Polygon coordinate correctness | `geometry.test.ts` (point-in-polygon, concave, self-intersection, letterbox/pillarbox, round-trip, mask centroid), E2E "draw a target zone: display coordinates map to source pixels" (±2 px) |
| 8 | Invalid video upload | `api-jobs.test.ts` "8. …" (wrong extension, fake MP4 bytes, > 25 MB, > 12 s, unconfirmed zone, zone out of frame; no files left behind), E2E "invalid upload…" |
| 9 | API timeout / failure | `sam-client.test.ts` (timeout → `aborted`, HTTP 401 → `unauthorized`, `response.failed`, missing key), `evaluator.test.ts` incomplete stream, `api-jobs.test.ts` worker failure → INCONCLUSIVE + refund |
| 10 | Stripe valid webhook (billing enabled) | `stripe-webhook.test.ts` "10. …" (+20 credits) |
| 11 | Stripe invalid signature | "11. …" (wrong secret, missing header, tampered body → 400, no credits) |
| 12 | Stripe duplicate event | "12. …" (3 replays), "12b" (two events, one Checkout Session), "12c" (5 concurrent replays) → 20 credits once |
| 13 | Stripe checkout cancellation | "13. …" expired → nothing; "13b" async: unpaid waits, failed → nothing, succeeded → grant; E2E success/cancel pages grant nothing |
| 14 | Cross-session access denial | `api-jobs.test.ts` "14. …" (other session, anonymous, forged cookie → 404; private video 404), E2E "14. another session cannot see a private evaluation" |

Also covered: Idempotency-Key retries reuse the job and debit once. The free allowance is
followed by 402 when no credits remain. Live mode is refused without `MODEL_API_KEY`, and fixture
mode is refused without a recorded real API output.

## Billing flag

Billing is **off by default** (`BILLING_ENABLED` unset). `tests/unit/billing-off.test.ts`
covers the off state: `/api/checkout` and `/api/stripe/webhook` return 404, the session
reports `billingEnabled: false`, and past the per-session cap a live run gets 429 with no credit
debit. The E2E suite runs with billing off: there is no Pricing link and `/pricing` says billing
is turned off. Scenarios 10–13 run in unit tests with `BILLING_ENABLED=true`.

## Live Meta SAM 3.1 (real API calls, 2026-11-05)

`pnpm sam:probe public/samples/<clip>.mp4 "red cube" --record fixtures/recorded/<clip>.red-cube.json`.
Each call streamed to `response.completed` and was decoded with `@meta-sam/parser`. Each clip
is 960×540, 30 fps, 240 frames.

| Clip | Stream | Frames with detections | Object IDs | Final centroid (source px) | Verdict (tray zone) |
|---|---|---|---|---|---|
| synthetic-pass | completed, 17.3 s | 240 / 240 | `0` only | (739.3, 375.8), inside | **PASS** `PASS_ENTERED_TARGET` |
| synthetic-fail | completed, 14.2 s | 240 / 240 | `0` only | (478.5, 387.1), outside | **FAIL** `FAIL_OUTSIDE_TARGET` |
| synthetic-occluded | completed, 11.9 s | 177 / 240 (frames 0–176) | `0` only | lost behind the panel at frame 176 | **INCONCLUSIVE** `INC_MISSING_FINAL_OBSERVATIONS` |

Verdicts are asserted in `tests/unit/recorded-fixtures.test.ts`, which replays the recorded
outputs through the parser and the evaluator.

The full app was also checked end to end (`next dev` plus `pnpm worker`, billing off):

| Run | Result |
|---|---|
| Live run of synthetic-pass | `PASS`, provenance `live` |
| Fixture replay of synthetic-pass | `PASS`, provenance `fixture` |
| Fixture replay of synthetic-occluded | `INCONCLUSIVE`, provenance `fixture` |

## Not verified in this environment

| Item | Status |
|---|---|
| Stripe Checkout against Stripe's servers | Not run: billing is off by default and test keys were not provided. Webhook verification uses real Stripe SDK signatures (`generateTestHeaderString` + `constructEvent`). |
| Real-world (non-synthetic) robot footage | Not tested; only the three synthetic clips above. |

E2E tests run with `MODEL_API_KEY` and Stripe keys deliberately empty, so they never call
external services. The result-page E2E tests seed completed jobs whose provenance is `test`, and
the UI labels these "Synthetic test data — not model output". Their verdicts are computed by the
real evaluator.

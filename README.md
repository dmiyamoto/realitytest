# RealityTest

**Unit tests for the physical world.**

RealityTest is an open-source app that evaluates observable physical tasks from short videos.
The first use case is robotic pick-and-place. You upload a clip, name the object
(e.g. `red cube`), and draw the target region (e.g. the blue tray). **Meta SAM 3.1** tracks the
object across frames, and a **deterministic geometry engine** returns:

| Verdict | Meaning |
|---|---|
| `PASS` | ≥ 3 of the last 5 usable observations have the object's mask centroid inside the target polygon, the object was seen outside earlier, coverage is sufficient, and there is one unambiguous object |
| `FAIL` | Coverage is sufficient and the object stays **visible** outside the target in ≥ 3 of the last 5 usable observations |
| `INCONCLUSIVE` | No detection, ambiguous objects, low coverage, object lost or occluded at the end, unsuitable video, or an API/stream failure |

Every verdict comes with visual evidence: the real SAM 3.1 masks and boxes over the video, the
movement trail, the target zone, a per-frame timeline, the decisive frames with their original
frame indices and object IDs, tracking coverage, and explicit limitations.

> RealityTest checks **2D image-plane geometry**. It does **not** prove 3D containment or contact,
> and it is **not** a safety certification.

Built for the Meta Global AI Developer Hackathon 2026. MIT licensed.

---

## How it works

```
video ──► Meta Model API (sam-3.1, /v1/responses, stream) ──► @meta-sam/parser
                                                                   │  boxes + masks per frame,
                                                                   ▼  stable object IDs
           user-confirmed polygon ──► geometry engine (centroid ∈ polygon) ──► PASS / FAIL / INCONCLUSIVE
```

1. The video is uploaded to `POST /v1/files` (`purpose: user_data`). A Responses API request is
   sent with an `input_text` concept prompt and an `input_video` part, using `stream: true`.
2. The stream is consumed until `response.completed`. It is decoded **only** with the official
   [`@meta-sam/parser`](https://www.npmjs.com/package/@meta-sam/parser) (`parseVideoStream`,
   `decodeMaskToRaster`, `decodeMaskToSVGPath`), never with regexes. Frame indices come from the
   `<Nf>` markers, so sparse or out-of-order frames are handled. Object IDs are kept verbatim.
3. For each frame, the mask raster is decoded and its centroid is computed in source pixels. The
   engine checks the centroid against the polygon you drew. Display coordinates are converted to
   source pixels with letterbox-aware math (`src/lib/evaluation/geometry.ts`).
4. Verdict rules are in `src/lib/evaluation/evaluator.ts`. The coverage threshold defaults to 60%
   (`EVAL_COVERAGE_THRESHOLD`). AI errors are **never** turned into a PASS or FAIL.

### Provenance labels

| Label | Meaning |
|---|---|
| **Live Meta SAM 3.1** | Real API call made for this evaluation |
| **Recorded API fixture** | A saved response from a previous *real* SAM 3.1 call (`fixtures/recorded/*.json`, recorded with `pnpm sam:probe --record` for the three demo clips), replayed through the same parser |
| **Synthetic test data — not model output** | Seeded only by automated E2E tests; never produced by the app |

---

## Quick start

Requirements: Node ≥ 22, pnpm 10, ffmpeg/ffprobe on `PATH`.

```bash
pnpm install
cp env.example .env.local          # then fill in MODEL_API_KEY and SESSION_SECRET
pnpm db:push
pnpm dev                           # web app on http://localhost:3000
pnpm worker                        # in a second terminal: the evaluation worker
```

Probe the real API directly (Phase-1 check). This records the raw output as a fixture:

```bash
pnpm sam:probe public/samples/synthetic-pass.mp4 "red cube" --record fixtures/recorded/synthetic-pass.red-cube.json
```

### Docker

```bash
docker compose up --build          # web on :3000 + worker, SQLite and uploads on a named volume
```

### Billing (optional, off by default)

Stripe billing is **off** unless `BILLING_ENABLED=true`. When it is off, there is no pricing page
or checkout, `/api/checkout` and `/api/stripe/webhook` return 404, and live evaluations are free,
capped by `FREE_EVALUATIONS_PER_SESSION` (default 20) and `MAX_LIVE_EVALUATIONS_PER_DAY`
(default 100). The flag is read per request, so no rebuild is needed.

To turn it on (Stripe **test mode**), set `BILLING_ENABLED=true` and the Stripe keys, then:

```bash
pnpm stripe:setup                  # creates the $9 / 20-credit price, prints STRIPE_PRICE_ID_PACK20
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints STRIPE_WEBHOOK_SECRET
```

Pay with card `4242 4242 4242 4242`. Credits are granted **only** by the signature-verified
webhook. Visiting the success URL grants nothing. Non-test keys are refused unless
`STRIPE_LIVE_MODE_APPROVED=owner-approved` is set, and that must not be done without stronger
authentication.

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js app |
| `pnpm worker` | Persistent job worker (claims pending jobs atomically) |
| `pnpm lint` · `pnpm typecheck` | ESLint · TypeScript |
| `pnpm test` | Vitest unit + integration tests (geometry, verdicts, parser, API, Stripe, sessions) |
| `pnpm test:e2e` | Playwright end-to-end tests (builds and serves the app; no external calls) |
| `pnpm sam:probe <video> "<prompt>"` | One real SAM 3.1 request with a decoded summary |
| `pnpm clips` | Regenerate the synthetic demo clips |

## Configuration

See [`env.example`](env.example). Key variables: `MODEL_API_KEY`, `BILLING_ENABLED`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PACK20`, `NEXT_PUBLIC_APP_URL`, `SESSION_SECRET`,
`DATABASE_URL`, `STORAGE_DIR`, `FREE_EVALUATIONS_PER_SESSION`, `MAX_LIVE_EVALUATIONS_PER_DAY`,
`EVAL_COVERAGE_THRESHOLD`.

## Upload limits

MP4/MOV, H.264/H.265/MPEG-4, ≤ 12 s, ≤ 25 MB. These are checked server-side against the actual
bytes with ffprobe.

## Demo clips

`public/samples/synthetic-*.mp4` are **computer-generated** clips rendered by
`scripts/make-synthetic-clips.py`. They are original to this repository (MIT), and every frame
is labelled "SYNTHETIC DEMO CLIP". No third-party footage is included.

## Docs

- [Architecture](docs/ARCHITECTURE.md), including the limits of this MVP for production
- [Test results](docs/TEST_RESULTS.md)
- [日本語 README](README.ja.md)

## Security notes

Guest sessions are signed HttpOnly cookies. Evaluations and uploaded videos are visible only to
the session that created them (other sessions get 404). This is suitable for a TEST-MODE demo
only. Real paid accounts need proper authentication. No secrets, uploads or user data are
committed (`.gitignore`, `.dockerignore`).

## License

[MIT](LICENSE). Meta SAM 3.1 is accessed through the Meta Model API, and `@meta-sam/parser` is
used under its own license (SAM License).

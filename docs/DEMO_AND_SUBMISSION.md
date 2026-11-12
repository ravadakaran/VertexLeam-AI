# Demo and submission

Full demo evidence is planned. Use non-production fixtures and record environment, commit and role in each evidence item. Use a one-module DSA course with a short captioned sorting lecture, a timecoded transcript (including a quicksort explanation near 842 seconds in the citation fixture), PDF/slides, an assignment rubric, objective and short-answer quiz items, and two topics. The short playback asset and longer citation fixture can be separate lectures or seeded source assets. Keep a second course with similar text and no student enrollment to verify isolation.

## D1 · First slice

Register and sign in as student. Sign in separately as instructor, create a pending course and confirm it stays out of public catalog. Use the authorized admin fixture to submit/approve that course and inspect the decision log. Browse with combined filters, enroll, repeat the request and reload or sign in again. Confirm the dashboard restores one enrollment. In the final demo perform submission and approval through the real admin workspace.

## D2 · Learning core

As instructor upload playable lecture media and resources, publish a quiz and set an assignment deadline/rubric. As enrolled student watch, pause, resume, change speed, save a timestamped note and bookmark, submit a clean file and take a quiz. Show the immediate objective score and pending short answer. As instructor grade the assignment and short answer. As student finish all required lectures and download a single certificate after the background job completes. Show streak/badges and reconcile analytics. Repeat selected requests and attempt access from a different learner.

## D3 · AI tutor

Ingest transcript, captions, PDF pages and slide text; inspect the active generation's source metadata. Ask supported questions in multiple persisted sessions, follow lecture/time/page citations, and repeat with another explanation mode. Ask an unsupported or cross-course question and show bounded fallback or access denial. Simulate provider outage, observe retryable tutor failure and demonstrate core playback/CRUD still work. Download a cited summary, save generated flashcards and review a due card. Generate a seven-day AI study plan from finalized quiz history and verify mastery priorities. As instructor generate a draft, inspect/edit and approve it. Confirm student sees the published assessment without keys. Record token totals without exposing prompt content.

## D4 · Deployed governance and release

Use admin to approve and reject submitted courses, assign and revoke roles, suspend a synthetic user and verify invalidated credentials. Complete account deletion only after the retention and anonymization policy in [DEC-14](DECISIONS.md#decisions-and-open-issues) is confirmed. Post instructor announcement and threaded student reply, report a post, moderate with owning instructor or admin, and verify in-app and sandbox email notification. Compare DAU, enrollments, completion and labeled demo revenue with the [analytics fixture](PERSONALIZATION_AND_ANALYTICS.md). Verify final staging smoke and production digest, accessibility and load results. Confirm known-good rollback digest and restore drill record.

## Evidence index

| ID | Attachments to collect | Status |
|---|---|---|
| D1 | First-slice role screens, API traces, persisted enrollment and decision audit | Planned |
| D2 | Playback resume, annotation, file/grade, quiz and certificate workflow, negative access tests | Planned |
| D3 | Retrieval and summary citations, module flashcards, private quiz draft review, mastery/study plan, provider outage and AI evaluation workbook/results | Planned |
| D4 | Admin approvals and role/suspension audit, platform metrics and synthetic revenue reconciliation, moderation decisions, CI status, staging smoke, accessibility/load and release/restore outputs | Planned |
| L1 | Live cohort completion/streak analysis and 30-day core uptime | Requires observation |

Capture commands, test data, release SHA, actual outputs and dates. Keep synthetic account secrets in approved configuration. Archive sanitized screenshots, CI logs and contract checks with the same revision. Record the approved Word PRD reference and [scope ledger](PROJECT_REQUIREMENTS.md) in the submission.

## Foundation verification

Local results on 4 November 2026 for TASK-001–005 using Windows, Node 24, Docker Compose and synthetic data.

| Checks | Observed result |
|---|---|
| T-001 | PostgreSQL 17 with pgvector and Redis reached healthy status. The readiness endpoint passed. |
| T-002 | A fresh disposable database accepted two migration runs and two seed runs. Three fixture accounts remained. |
| T-003 | API integration checks passed for student registration, login, expiry, refresh rotation and replay, logout, forgery, suspension and throttling. |
| T-004 | API integration checks passed for review audit and retry, hidden pending and rejected courses, combined filters, forbidden actions and six concurrent enrollment requests returning one enrollment. |
| T-005 | Chromium verified each role's sign-in, navigation and sign-out, plus signed-out and wrong-role access to a protected URL. |

`npm run typecheck` and `npm run build` passed locally. The hosted GitHub Actions run and deployment evidence remain planned.

## Learning and assessment verification

Local results on 4 November 2026 using Docker PostgreSQL and Redis, Node 24, synthetic uploads and Chromium.

| Check | Observed result |
|---|---|
| T-006 | Chromium created a course as instructor, approved it with the demo admin fixture, enrolled as student and restored the learning dashboard after reload and sign-in. |
| T-007 | The API accepted video, PDF, PPTX and WebVTT. It served a private playlist and segments and rejected unsigned, expired and non-member requests. Chromium played the stream at 1.5× and received a caption link. |
| T-008 | Reordered and duplicate heartbeats preserved the newest resume position and unique coverage. The API isolated notes and bookmarks by learner. Chromium recorded full playback and saved a timestamped note. |
| T-009 | PDF, ZIP and code submissions passed. The API rejected traversal, active PDF, a malware test string, late submissions and cross-owner grading. Rubric scores produced a grade visible to the submitter. Chromium submitted a synthetic code file. |
| T-010 | Draft and answer-key isolation, version pinning, all three question types, manual grading and stable retries passed. Chromium authored, published and completed an objective quiz. |

The integration suite passed after two migration and seed runs against a fresh disposable database. TypeScript checks, the production frontend build and OpenAPI validation passed. Antivirus-backed uploads, hosted CI and deployment remain unverified.

## Awards, analytics and AI verification

Local results on 5 November 2026 using the synthetic PostgreSQL/Redis stack. T-011 verified idempotent first-course and seven-day badges, perfect-quiz badge, one private certificate under the test-only policy flag, owner download and cross-learner denial. T-012 verified playback-start counts and instructor ownership denial. T-013–015 verified non-enrolled tutor denial and the 503 path when service/provider configuration is absent. `npm run typecheck`, `npm run build`, Python syntax compilation, migrations and the backend integration suite passed. Live provider calls, transcription/document extraction, AI citation quality, cloud deployment and production evidence remain unverified. Certificate and outbound AI data processing remain disabled by default pending DEC-02 and DEC-09.

Local results on 10 November 2026 added verified regression coverage against the local PostgreSQL/Redis stack, Chromium, and offline mock adapters:

- Backend integration suite (`npm test`): 13/13 checks passed, including `course_title` projection on `/enrollments/me`, owning-instructor reviewer tutor sessions (`201`, mode `PUT`, `200` reply without recording `learner_activity`), strict student/instructor session isolation (`404`), admin/non-member tutor denial (`403`), chat `request_id` replay (`200`) and mismatch conflict (`409`), and lecture ingest/publish activation against a mock HTTP adapter.
- Offline AI service tests (`ai-service/tests/test_main.py`): 5/5 Python `unittest` checks passed in an isolated container built from `ai-service/requirements.txt`, covering `/health/ready`, `401` invalid/expired JWT rejection, `503` enforcement when `AI_OUTBOUND_DATA_APPROVED` is unset/false, `403` `sub`/`course_id` scope mismatches, assessment-key marker stripping, and mocked `/v1/chat` and `/v1/summarize` responses.
- Static checks & browser suite: `npm run typecheck`, `npm run build`, and Playwright Chromium E2E (`npm run test:e2e`, 2/2 specs: `workspaces.spec.ts` and `learning.spec.ts`) passed.

Live provider calls, transcription/document extraction, AI citation quality, hosted CI, cloud deployment, and manual visual/WCAG inspection remain unverified. Certificate issuance, outbound AI data processing, and account deletion remain disabled by default pending DEC-02, DEC-09, and DEC-14.

## Operational and release verification

Local results on 10 November 2026 for TASK-021–025 using Windows, Node 24, Python 3.12, Docker Compose, PostgreSQL 17 with pgvector, Redis 7.4, Chromium, and offline mock adapters:

The finalization pass reran typecheck, build, backend integration, AI service, and browser checks. The T-021 regression confirms notification listing omits course notices after enrollment ends; the browser workspace check covers the accessible password visibility toggle. Course approval policy and the remaining production gates are unchanged.

- **Backend integration & fault/security suite (`npm test`)**: 17/17 tests passed across [foundation tests](../backend/test/foundation.test.js), [learning tests](../backend/test/learning.test.js), and [ops and community tests](../backend/test/ops-and-community.test.js), covering T-021 nested threads/same-thread `parent_id`, duplicate-report `409`, admin moderation sync & learner hiding (`[Hidden by moderation]`), course announcements, outbox worker failure/replay & webhook email dedupe, `PUT /notifications/:id/read` scoping; T-022 catalog/course/leaderboard Redis caching & mutation invalidation, PII-omitted leaderboard rankings, Prometheus `/metrics`, and all eight Redis rate-limit buckets (`auth-ip`, `auth-account`, `catalog-ip`, `user`, `upload`, `ai-chat`, `ai-chat-ip`, `ai-jobs`); and T-024 AI unreachable `503` isolation, Redis outage fail-open catalog vs fail-closed login, and JSON log PII/JWT redaction.
- **Offline AI service tests**: `compileall` and Python `unittest` (`ai-service/tests/test_main.py`) passed 7/7 checks, including structured log redaction and readiness verification.
- **Static & Playwright browser verification (`npm run typecheck`, `npm run build`, `npm run test:e2e`)**: TypeScript checks, Vite production bundle (`vite build frontend`), and 3/3 Chromium E2E specs ([`workspaces.spec.ts`](../frontend/test/workspaces.spec.ts), [`learning.spec.ts`](../frontend/test/learning.spec.ts), and [`accessibility-and-community.spec.ts`](../frontend/test/accessibility-and-community.spec.ts)) passed, verifying announcements, in-app notification read marking, leaderboard rendering, threaded reply/reporting, English-only navigation, admin moderation masking, and automated WCAG 2.1 AA color contrast and landmark checks in both light and dark themes.
- **DSA demo seeding, backup/restore & stage containers**: `npm run demo:seed` passed twice idempotently (`00000000-0000-4000-8000-00000000d5a1`), `pwsh -File infra/scripts/restore-drill.ps1` passed PostgreSQL dump/restore row-count integrity verification in 3.65s, `docs/api-spec.yaml` parsed cleanly (`64` paths), `docker compose --env-file .env -f infra/docker-compose.yml config --quiet` passed, and stage container builds succeeded for `backend/Dockerfile`, `frontend/Dockerfile`, and `ai-service/Dockerfile`.

Manual screen-reader/keyboard assistive-technology testing, staging 100-VU `k6` load execution (`infra/load/k6-100vu.js`), Terraform cloud provisioning (`infra/terraform/`), hosted GitHub Actions CI/promotion runs (`.github/workflows/ci.yml`, `.github/workflows/deploy.yml`), live cohort completion/streak analysis (`L1`), and rolling 30-day uptime observation (`L1`) remain Planned / Require observation. Certificate issuance, outbound AI data processing, and account deletion remain disabled by default pending DEC-02, DEC-09, and DEC-14.

## Documentation verification

The planning handoff was checked against all 29 original functional IDs and priorities, all 34 PRD entities, and all 40 documented method/path pairs. The OpenAPI 3.0.3 file passed openapi-spec-validator, the Markdown targets and anchors resolved, and the source Word document retained its original SHA-256. These are documentation checks. See [foundation verification](#foundation-verification) for observed application checks.

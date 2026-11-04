# Ordered backlog

Each acceptance criterion has a matching check in the [test register](TESTING_STRATEGY.md#test-register). Priorities in the [requirements ledger](PROJECT_REQUIREMENTS.md) remain authoritative. Local foundation results are recorded in [foundation verification](DEMO_AND_SUBMISSION.md#foundation-verification).

## TASK-001

Bootstrap Compose, CI and repository · Day 1 · P0

- Depends on local toolchain.
- Implementation [Compose](../infra/docker-compose.yml) and [CI](../.github/workflows/ci.yml).
- Requirements STACK-CORE, TOOLS-DEV.
- Acceptance. Fresh start passes database and Redis readiness and CI runs a smoke check.

## TASK-002

Core migrations and seeds · Day 2 · P0

- Depends on [TASK-001](TASKS.md#task-001).
- Implementation [migrations](../backend/src/db/migrate.ts) and [seeds](../backend/src/db/seed.ts).
- Requirements DATA-STORE.
- Acceptance. Empty database migrates twice safely and seeds three roles and test accounts.

## TASK-003

Auth and role boundary · Day 3 · P0

- Depends on [TASK-002](TASKS.md#task-002).
- Implementation [auth routes](../backend/src/modules/auth/routes.ts) and [role middleware](../backend/src/middleware/auth.ts).
- Requirements FR-S1, SCOPE-AUTH, NFR-AUTH, API-AUTH, API-ERROR.
- Acceptance. Register, login, refresh, replay and revoke; forged roles and suspended users fail.

## TASK-004

Course catalog, minimum approval and enrollment · Day 4 · P0

- Depends on [TASK-003](TASKS.md#task-003).
- Implementation [course routes](../backend/src/modules/courses/routes.ts) and [enrollment service](../backend/src/modules/enrollments/service.ts).
- Requirements FR-S3, FR-I1, API-COURSES.
- Acceptance. Pending hidden; admin fixture approves; repeat or concurrent enroll produces one row; category, difficulty, rating and search compose.

## TASK-005

Role workspaces and auth shell · Day 5 · P0

- Depends on [TASK-003](TASKS.md#task-003).
- Implementation [workspace routes](../frontend/src/routes/App.tsx) and [workspace flows](WORKSPACE_FLOWS.md).
- Requirements STACK-UI, TOOLS-DESIGN.
- Acceptance. All three fixture roles sign in and see their navigation; direct protected route checks work.

## TASK-006

First vertical slice and buffer · Day 6–7 · P0

- Depends on [TASK-004](TASKS.md#task-004), [TASK-005](TASKS.md#task-005).
- Implementation [catalog, authoring and learning dashboard](../frontend/src/pages/Learning.tsx) and [demo approval](../backend/src/db/approve-demo-course.ts).
- Requirements FR-S2, SCOPE-LEARNING, ROLE-STUDENT, PLAN-W1.
- Acceptance. Instructor creates; authorized seed approves the same course; student enrolls; reload restores dashboard state.

## TASK-007

Media upload and playback · Day 8 · P0

- Depends on [TASK-004](TASKS.md#task-004), [TASK-005](TASKS.md#task-005).
- Implementation [media and curriculum routes](../backend/src/modules/learning/routes.ts), [upload validation and packaging](../backend/src/modules/learning/uploads.ts) and [player](../frontend/src/pages/CourseWorkspace.tsx).
- Requirements FR-S4, FR-I2, SCOPE-VIDEO.
- Acceptance. Owner uploads video, PDF and slides; approved playback uses private HLS and supports speed; non-member denied.

## TASK-008

Progress, notes and bookmarks · Day 9 · P0/P1

- Depends on [TASK-007](TASKS.md#task-007).
- Implementation [progress service](../backend/src/modules/learning/progress.ts), [annotation routes](../backend/src/modules/learning/routes.ts) and [player](../frontend/src/pages/CourseWorkspace.tsx).
- Requirements FR-S5, API-PROGRESS.
- Acceptance. Out-of-order heartbeats preserve newest resume and monotonic completion; private annotations retain timestamps.

## TASK-009

Assignments and grading · Day 10 · P0

- Depends on [TASK-004](TASKS.md#task-004), [TASK-007](TASKS.md#task-007).
- Implementation [assignment API](../backend/src/modules/assignments/routes.ts) and [assessment workspace](../frontend/src/pages/Assessments.tsx).
- Requirements FR-S6, FR-I3, SCOPE-ASSESS.
- Acceptance. Safe PDF, ZIP and code submitted before deadline; late, malicious and cross-owner writes denied; rubric grade visible to submitter.

## TASK-010

Manual quizzes, attempts and scoring · Day 11 · P0

- Depends on [TASK-004](TASKS.md#task-004), [TASK-005](TASKS.md#task-005).
- Implementation [quiz API](../backend/src/modules/quizzes/routes.ts) and [assessment workspace](../frontend/src/pages/Assessments.tsx).
- Requirements FR-S7, API-ASSESS.
- Acceptance. All three question types supported; only objective auto-scored; retry preserves score and answer keys stay private.

## TASK-011

Certificates, badges and streaks · Day 12 · P1/P2

- Depends on [TASK-008](TASKS.md#task-008), [TASK-010](TASKS.md#task-010).
- Planned paths `backend/src/modules/gamification`, `backend/src/jobs`, `frontend/src/pages/dashboard`.
- Requirements FR-S8, FR-S9, SCOPE-AWARDS, API-REWARDS, JOB-STREAK, JOB-CERT.
- Acceptance. Completion produces one private PDF across retries; three milestone fixtures produce unique badge awards.

## TASK-012

Instructor analytics and buffer · Day 13–14 · P1

- Depends on [TASK-008](TASKS.md#task-008), [TASK-010](TASKS.md#task-010).
- Planned paths `backend/src/modules/courses`, `frontend/src/components/instructor`.
- Requirements FR-I5, SCOPE-INSTRUCTOR, PLAN-W2.
- Acceptance. Drop-off, score and time-on-task match deterministic fixtures; owner-only view.

## TASK-013

AI runtime and provider adapter · Day 15 · P0

- Depends on local toolchain.
- Planned paths `ai-service/app/core`, `ai-service/app/main.py`, `infra`.
- Requirements STACK-AI, TOOLS-AI.
- Acceptance. Authenticated internal calls work; readiness and timeout paths have offline tests.

## TASK-014

Transcribe, parse, embed and publish · Day 16 · P0

- Depends on [TASK-007](TASKS.md#task-007), [TASK-013](TASKS.md#task-013).
- Planned paths `ai-service/app/rag`, `backend/src/jobs`, `backend/src/db`.
- Requirements JOB-TRANSCRIBE, JOB-EMBED.
- Acceptance. Retry leaves one active source generation; vectors have 1536 dimensions and segments retain offsets.

## TASK-015

Course-scoped tutor · Day 17 · P0

- Depends on [TASK-014](TASKS.md#task-014).
- Planned paths `ai-service/app/routers/chat.py`, `frontend/src/components/ai-tutor`.
- Requirements FR-A1, FR-A2, SCOPE-TUTOR, API-AI, SYS-RAG, KPI-LATENCY.
- Acceptance. Good source cites correct lecture; identical cross-course text, injected instructions and provider outage are handled.

## TASK-016

Summaries and flashcards · Day 18 · P0/P2

- Depends on [TASK-014](TASKS.md#task-014).
- Planned paths `ai-service/app/routers`, `frontend/src/components/ai-tutor`.
- Requirements FR-A3, FR-A7, SCOPE-AI-TOOLS.
- Acceptance. Summary and module flashcards are grounded and omit assessment keys.

## TASK-017

AI quiz review · Day 19 · P0/P1

- Depends on [TASK-010](TASKS.md#task-010), [TASK-014](TASKS.md#task-014).
- Planned paths `ai-service/app/routers/quiz_gen.py`, `backend/src/modules/quizzes`, `frontend/src/components/instructor`.
- Requirements FR-A5, FR-I4, ROLE-INSTRUCTOR, KPI-QUIZ.
- Acceptance. 5–10 transcript-based questions remain draft until owned review and approval.

## TASK-018

Modes, mastery, study plan, recommendations and buffer · Day 20–21 · P1

- Depends on [TASK-010](TASKS.md#task-010), [TASK-015](TASKS.md#task-015).
- Planned paths `ai-service/app/recommendation`, `ai-service/app/routers/study_plan.py`, `backend/src/jobs`, `frontend/src/components/ai-tutor`.
- Requirements FR-S10, FR-A4, FR-A6, FR-A8, SCOPE-MODES, SCOPE-RECS, JOB-RECOMMEND, PLAN-W3.
- Acceptance. Deterministic event replay yields expected mastery band, approved recommendations and history-based study steps.

## TASK-019

Governance UI and account lifecycle · Day 22 · P0

- Depends on [TASK-004](TASKS.md#task-004), [TASK-005](TASKS.md#task-005).
- Planned paths `backend/src/modules/admin`, `frontend/src/pages/admin-panel`.
- Requirements FR-AD1, FR-AD2, FR-AD4, SCOPE-ADMIN, API-ADMIN, ROLE-ADMIN.
- Acceptance. Admin reviews pending items, changes roles and suspends/deletes accounts; sessions revoked and audit rows present.

## TASK-020

Platform metrics and moderation queue · Day 23 · P1/P2

- Depends on [TASK-011](TASKS.md#task-011), [TASK-012](TASKS.md#task-012), [TASK-019](TASKS.md#task-019).
- Planned paths `backend/src/modules/admin`, `frontend/src/pages/admin-panel`.
- Requirements FR-AD3.
- Acceptance. Metrics reconcile to fixtures and revenue is labeled synthetic; moderation tested against seeded reports until Day 24.

## TASK-021

Forum, announcements and notification delivery · Day 24 · P1/P2

- Depends on [TASK-019](TASKS.md#task-019), [TASK-020](TASKS.md#task-020).
- Planned paths `backend/src/modules/discussions`, `backend/src/modules/notifications`, `backend/src/jobs`, `frontend/src/components`.
- Requirements FR-I6, FR-AD5, SCOPE-FORUM, SCOPE-NOTIFY, JOB-NOTIFY.
- Acceptance. Enrolled students can thread/reply/report; owner/admin moderation scoped; outbox replay gives one in-app notification and provider dedupe where supported.

## TASK-022

Accessibility, dark mode, locale scaffolding, caching and throttling · Day 25 · P0/P1

- Depends on [TASK-015](TASKS.md#task-015), [TASK-019](TASKS.md#task-019), [TASK-021](TASKS.md#task-021).
- Planned paths `frontend/src/styles`, `frontend/src/utils`, `backend/src/middleware`, `backend/src/config`.
- Requirements SCOPE-UI, NFR-A11Y, NFR-CACHE, NFR-RATE, API-LIMIT, SYS-CACHE.
- Acceptance. Both themes pass planned accessibility checks, default locale fallback works, cache expires/invalidates and all buckets throttle.

## TASK-023

Stage container release · Day 26 · P0

- Depends on [TASK-018](TASKS.md#task-018), [TASK-022](TASKS.md#task-022).
- Planned paths `infra`, `.github/workflows`, `backend/Dockerfile`, `ai-service/Dockerfile`.
- Requirements NFR-SCALE, NFR-OBS, SYS-COMPONENTS, OPS-ENV, OPS-CI, OPS-INFRA, TOOLS-CLOUD, TOOLS-OPS.
- Acceptance. CI checks all services and staging smoke records deployed digest.

## TASK-024

Load, fault and security verification · Day 27 · P0

- Depends on [TASK-023](TASKS.md#task-023).
- Planned paths `backend/tests`, `ai-service/tests`, `infra`.
- Requirements NFR-PERF, NFR-UPTIME, NFR-PRIVACY, ROLE-ENFORCE, STACK-QA, OPS-SCALE, TOOLS-QA.
- Acceptance. Archive load, denial, outage and restore evidence and fix release blockers.

## TASK-025

Production demo and submission · Day 28 · P0

- Depends on [TASK-024](TASKS.md#task-024).
- Planned paths `backend/src/db/seeders`, `docs`, `.github/workflows/deploy.yml`.
- Requirements PLAN-W4, OPS-ROLLBACK, KPI-COMPLETION, KPI-STREAK.
- Acceptance. Promote smoke-tested digests, run all three role journeys and capture evidence and rollback target.

Day 23 tests the moderation queue with seeded reports. Day 24 closes the forum-to-report-to-moderation dependency. Day 4 adds an admin-only approval action and Day 22 adds the governance workspace.

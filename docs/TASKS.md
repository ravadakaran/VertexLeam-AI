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
- Implementation [awards routes](../backend/src/modules/gamification/routes.ts), [certificate/job data migration](../backend/src/db/migrations/008_engagement_ai.sql), and student APIs at `/users/me/certificates`, `/users/me/badges`, `/users/me/streak`.
- Requirements FR-S8, FR-S9, SCOPE-AWARDS, API-REWARDS, JOB-STREAK, JOB-CERT.
- Acceptance. Completion produces one private PDF across retries; three milestone fixtures produce unique badge awards.

## TASK-012

Instructor analytics and buffer · Day 13–14 · P1

- Depends on [TASK-008](TASKS.md#task-008), [TASK-010](TASKS.md#task-010).
- Implementation [analytics routes](../backend/src/modules/analytics/routes.ts) and `GET /instructor/courses/{id}/analytics`.
- Requirements FR-I5, SCOPE-INSTRUCTOR, PLAN-W2.
- Acceptance. Drop-off, score and time-on-task match deterministic fixtures; owner-only view.

## TASK-013

AI runtime and provider adapter · Day 15 · P0

- Depends on local toolchain.
- Implementation [FastAPI service](../ai-service/app/main.py), [service image](../ai-service/Dockerfile), and optional Compose profile `ai`.
- Requirements STACK-AI, TOOLS-AI.
- Acceptance. Authenticated internal calls work; readiness and timeout paths have offline tests.

## TASK-014

Transcribe, parse, embed and publish · Day 16 · P0

- Depends on [TASK-007](TASKS.md#task-007), [TASK-013](TASKS.md#task-013).
- Implementation ingestion generations and chunks across [migration 008](../backend/src/db/migrations/008_engagement_ai.sql) and [migration 013](../backend/src/db/migrations/013_ai_learning_tools.sql), with owner-scoped transcript, PDF, PPTX, WebVTT ingestion and publish routes in [AI routes](../backend/src/modules/ai/routes.ts) and extraction in [AI service](../ai-service/app/main.py).
- Requirements JOB-TRANSCRIBE, JOB-EMBED.
- Acceptance. Retry leaves one active source generation; vectors have 1536 dimensions and segments retain offsets.

## TASK-015

Course-scoped tutor · Day 17 · P0

- Depends on [TASK-014](TASKS.md#task-014).
- Implementation course-scoped chat, mode, session-local bounded history, tutor routes and FastAPI retrieval in [AI routes](../backend/src/modules/ai/routes.ts) and [AI service](../ai-service/app/main.py).
- Requirements FR-A1, FR-A2, SCOPE-TUTOR, API-AI, SYS-RAG, KPI-LATENCY.
- Acceptance. Good source cites correct lecture; identical cross-course text, injected instructions and provider outage are handled.

## TASK-016

Summaries and flashcards · Day 18 · P0/P2

- Depends on [TASK-014](TASKS.md#task-014).
- Implementation [AI tool endpoints](../ai-service/app/main.py), [course-scoped routes and saved private flashcards](../backend/src/modules/ai/routes.ts) and [learning tools UI](../frontend/src/pages/CourseWorkspace.tsx), including summary downloads and due-card review.
- Requirements FR-A3, FR-A7, SCOPE-AI-TOOLS.
- Acceptance. Summary and module flashcards are grounded and omit assessment keys.

## TASK-017

AI quiz review · Day 19 · P0/P1

- Depends on [TASK-010](TASKS.md#task-010), [TASK-014](TASKS.md#task-014).
- Implementation [quiz draft generation](../ai-service/app/main.py), [owned draft route](../backend/src/modules/ai/routes.ts), [review and publish flow](../backend/src/modules/quizzes/routes.ts) and [instructor UI](../frontend/src/pages/Assessments.tsx).
- Requirements FR-A5, FR-I4, ROLE-INSTRUCTOR, KPI-QUIZ.
- Acceptance. 5–10 transcript-based questions remain draft until owned review and approval.

## TASK-018

Modes, mastery, study plan, recommendations and buffer · Day 20–21 · P1

- Depends on [TASK-010](TASKS.md#task-010), [TASK-015](TASKS.md#task-015).
- Implementation [mastery and personalization APIs](../backend/src/modules/personalization/routes.ts), [quiz topic validation and evidence updates](../backend/src/modules/quizzes/routes.ts), [tutor self-assessment evidence](../backend/src/modules/ai/routes.ts), [schema](../backend/src/db/migrations/010_personalization_admin.sql), [follow-up evidence migration](../backend/src/db/migrations/014_mastery_evidence.sql), [recommendation engine migration](../backend/src/db/migrations/016_recommendation_engine.sql), [instructor/learner UI](../frontend/src/pages/CourseWorkspace.tsx) and [student workspace](../frontend/src/pages/Learning.tsx).
- Requirements FR-S10, FR-A4, FR-A6, FR-A8, SCOPE-MODES, SCOPE-RECS, JOB-RECOMMEND, PLAN-W3.
- Acceptance. Course-owned topics map to quiz questions; finalized quiz results and explicit learner tutor check-ins replay deterministically into mastery score, confidence and updated_at. Learners see a course-scoped mastery dashboard, and study plans prioritize weaker topics. Phase 3 recommendation engine ingests 5 signals (quizzes, mastery, assignments, enrollments, AI tutor) to output targeted lecture resumes, module gap remediations, and catalog course suggestions.

## TASK-019

Governance UI and account lifecycle · Day 22 · P0

- Depends on [TASK-004](TASKS.md#task-004), [TASK-005](TASKS.md#task-005).
- Implementation [admin routes](../backend/src/modules/admin/routes.ts), [admin workspace](../frontend/src/pages/AdminPanel.tsx) and existing [course review](../backend/src/modules/courses/routes.ts). Account deletion remains gated by [DEC-14](DECISIONS.md#decisions-and-open-issues) until its retention policy is confirmed.
- Requirements FR-AD1, FR-AD2, FR-AD4, SCOPE-ADMIN, API-ADMIN, ROLE-ADMIN.
- Acceptance. Admin reviews pending items, changes roles and suspends/deletes accounts; sessions revoked and audit rows present.

## TASK-020

Platform metrics and moderation queue · Day 23 · P1/P2

- Depends on [TASK-011](TASKS.md#task-011), [TASK-012](TASKS.md#task-012), [TASK-019](TASKS.md#task-019).
- Implementation [platform analytics](../backend/src/modules/analytics/routes.ts), [moderation queue](../backend/src/modules/admin/routes.ts), [synthetic reporting schema](../backend/src/db/migrations/010_personalization_admin.sql) and [admin workspace](../frontend/src/pages/AdminPanel.tsx).
- Requirements FR-AD3.
- Acceptance. Metrics reconcile to fixtures and revenue is labeled synthetic; moderation tested against seeded reports until Day 24.

## TASK-021

Forum, announcements and notification delivery · Day 24 · P1/P2

- Depends on [TASK-019](TASKS.md#task-019), [TASK-020](TASKS.md#task-020).
- Implementation [discussion & announcement routes](../backend/src/modules/discussions/routes.ts), [notification routes](../backend/src/modules/notifications/routes.ts), [outbox relay](../backend/src/jobs/outbox.ts), [email dispatcher](../backend/src/jobs/email.ts), [standalone worker](../backend/src/jobs/worker.ts), [migration 012](../backend/src/db/migrations/012_community_ops_cache.sql), [community panel](../frontend/src/components/CourseCommunity.tsx) and [notifications bell](../frontend/src/components/NotificationsPanel.tsx).
- Requirements FR-I6, FR-AD5, SCOPE-FORUM, SCOPE-NOTIFY, JOB-NOTIFY.
- Acceptance. Enrolled students can thread/reply/report; owner/admin moderation scoped; outbox replay gives one in-app notification and provider dedupe where supported. Course-scoped notification reads require current access to an approved course.

## TASK-022

Accessibility, dark mode, English-only interface, caching and throttling · Day 25 · P0/P1

- Depends on [TASK-015](TASKS.md#task-015), [TASK-019](TASKS.md#task-019), [TASK-021](TASKS.md#task-021).
- Implementation [theme stylesheet](../frontend/src/styles/theme.css), [theme store](../frontend/src/utils/theme.ts), [English interface strings](../frontend/src/utils/i18n.ts), [rate limiter](../backend/src/middleware/rateLimit.ts), [runtime config](../backend/src/config/env.ts), [Redis cache helper](../backend/src/cache.ts), [catalog caching](../backend/src/modules/courses/service.ts) and [cached leaderboard](../backend/src/modules/gamification/routes.ts).
- Requirements SCOPE-UI, NFR-A11Y, NFR-CACHE, NFR-RATE, API-LIMIT, SYS-CACHE.
- Acceptance. Both themes pass planned accessibility checks, the interface remains in English with no language selector, cache expires/invalidates and all buckets throttle. Automated WCAG contrast and landmark checks pass locally; manual screen-reader and keyboard assistive-technology audits remain planned.

## TASK-023

Stage container release · Day 26 · P0

- Depends on [TASK-018](TASKS.md#task-018), [TASK-022](TASKS.md#task-022).
- Implementation [Compose stack](../infra/docker-compose.yml), [NGINX edge](../infra/nginx.conf), [CI workflow](../.github/workflows/ci.yml), [backend image](../backend/Dockerfile), [frontend image](../frontend/Dockerfile), [AI image](../ai-service/Dockerfile), [structured logger](../backend/src/utils/logger.ts), [Prometheus metrics](../backend/src/utils/metrics.ts) and Planned [ECS Fargate Terraform](../infra/terraform/main.tf). Cloud OIDC provisioning and staging digest deployment remain planned under [DEC-13](DECISIONS.md#decisions-and-open-issues).
- Requirements NFR-SCALE, NFR-OBS, SYS-COMPONENTS, OPS-ENV, OPS-CI, OPS-INFRA, TOOLS-CLOUD, TOOLS-OPS.
- Acceptance. CI checks all services and staging smoke records deployed digest.

## TASK-024

Load, fault and security verification · Day 27 · P0

- Depends on [TASK-023](TASKS.md#task-023).
- Implementation [ops and community integration suite](../backend/test/ops-and-community.test.js), [AI service unit tests](../ai-service/tests/test_main.py), [k6 100-VU script](../infra/load/k6-100vu.js) and [restore drills](../infra/scripts/restore-drill.ps1). Staging 100-VU benchmarks (`NFR-PERF`) and rolling 30-day uptime observation (`NFR-UPTIME`) remain planned / require observation.
- Requirements NFR-PERF, NFR-UPTIME, NFR-PRIVACY, ROLE-ENFORCE, STACK-QA, OPS-SCALE, TOOLS-QA.
- Acceptance. Archive load, denial, outage and restore evidence and fix release blockers.

## TASK-025

Production demo and submission · Day 28 · P0

- Depends on [TASK-024](TASKS.md#task-024).
- Implementation [idempotent DSA demo seeder](../backend/src/db/seeders/dsa-demo.ts), [accessibility and community E2E](../frontend/test/accessibility-and-community.spec.ts), [promotion workflow](../.github/workflows/deploy.yml) and [evidence & verification docs](DEMO_AND_SUBMISSION.md). Hosted release promotion and live cohort KPI measurements remain planned / require observation.
- Requirements PLAN-W4, OPS-ROLLBACK, KPI-COMPLETION, KPI-STREAK.
- Acceptance. Promote smoke-tested digests, run all three role journeys and capture evidence and rollback target.

Day 23 tests the moderation queue with seeded reports. Day 24 closes the forum-to-report-to-moderation dependency. Day 4 adds an admin-only approval action and Day 22 adds the governance workspace.

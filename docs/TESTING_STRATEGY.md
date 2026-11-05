# Testing strategy

Every test and release measurement below is planned. Use Jest/Supertest for core service and HTTP contracts, Pytest for AI adapters/retrieval and Playwright for complete role journeys. Run database tests against PostgreSQL with pgvector and queue tests against Redis. Use mocked providers for deterministic CI, then separately exercise authorized provider accounts in staging. Check learner responses for answer keys across quiz, tutor and reporting surfaces.

## Test register

Run T-001–004 with the [foundation integration suite](../backend/test/foundation.test.js) and the migration/seed commands in [local setup](ENVIRONMENT_SETUP.md#run-the-foundation). Run T-005 with the [Chromium workspace test](../frontend/test/workspaces.spec.ts). The [CI workflow](../.github/workflows/ci.yml) runs the same checks on a disposable stack.

The [Chromium learning walkthrough](../frontend/test/learning.spec.ts) covers T-006 and browser playback. The [learning integration suite](../backend/test/learning.test.js) covers T-007–012 and negative AI scope/configuration checks for T-013–015 with disposable accounts and synthetic media and assessment files. Live provider retrieval remains unverified until DEC-09 is resolved and an approved provider configuration is available.

| Test | Scenario | Fixtures and technique | Expected result |
|---|---|---|---|
| T-001 | Compose and CI | Fresh disposable services and clean CI checkout | Fresh start passes database and Redis readiness and CI runs a smoke check. |
| T-002 | Migrations | Empty and prior schema, role seeds, foreign key failure | Empty database migrates twice safely and seeds three roles and test accounts. |
| T-003 | Auth | Replay, expiry, invalid email, role override and session revocation | Register, login, refresh, replay and revoke; forged roles and suspended users fail. |
| T-004 | Catalog and enrollment | Pending/rejected/approved fixture, rating matrix, concurrent requests | Pending hidden; admin fixture approves; repeat or concurrent enroll produces one row; category, difficulty, rating and search compose. |
| T-005 | Workspace routes | Playwright role navigation and direct forbidden paths | All three fixture roles sign in and see their navigation; direct protected route checks work. |
| T-006 | First slice | Browser instructor create, admin fixture approval, student enroll and dashboard persistence | Instructor creates; authorized seed approves the same course; student enrolls; reload restores dashboard state. |
| T-007 | Upload and playback | Short HLS video, captions, PDF and slide, expired grant and cross-course deny | Owner uploads video, PDF and slides; approved playback uses private HLS and supports speed; non-member denied. |
| T-008 | Progress and annotations | Duplicate and reordered events, seek gaps, resume, private timestamped annotations | Out-of-order heartbeats preserve newest resume and monotonic completion; private annotations retain timestamps. |
| T-009 | Assignments | PDF/ZIP/code samples, exact deadline, malicious archive and ownership | Safe PDF, ZIP and code submitted before deadline; late, malicious and cross-owner writes denied; rubric grade visible to submitter. |
| T-010 | Quizzes | Objective scoring, pending manual review, keys absent and versioned retry | All three question types supported; only objective auto-scored; retry preserves score and answer keys stay private. |
| T-011 | Awards | One-module completion, repeated worker jobs, streak dates and all badge rules | Completion produces one private PDF across retries; three milestone fixtures produce unique badge awards. |
| T-012 | Instructor analytics | Four starts, three completions, finalized grades, overlapping time intervals and foreign owner | Drop-off, score and time-on-task match deterministic fixtures; owner-only view. |
| T-013 | AI service | Mock provider, expired service identity and timeout | Authenticated internal calls work; readiness and timeout paths have offline tests. |
| T-014 | Ingestion | Timestamped transcript, rerun/replacement, malformed asset and vector width | Retry leaves one active source generation; vectors have 1536 dimensions and segments retain offsets. |
| T-015 | Tutor | Cross-course twin corpus, legitimate answer, no-answer, injection, citation and provider fault | Good source cites correct lecture; identical cross-course text, injected instructions and provider outage are handled. |
| T-016 | Learning tools | Enrollment denial, provider outage, active lecture/module source scope and answer-key fishing | Summary and module flashcards use authorized active sources; AI outage returns 503. |
| T-017 | Drafts | Five to ten evidence-backed questions, idempotent retry, instructor review, learner denial before approval | AI drafts remain private until owner/admin review and approval; replay returns one draft. |
| T-018 | Personalization | Finalized topic score replay, three mastery bands, cold-start/history study plan and recommendations | Deterministic quiz evidence updates mastery; plan exposes history-based steps and recommendations recheck visibility. |
| T-019 | Admin | Pending approval queue, role changes, suspension/reactivation, revocation and audit | Admin review and account controls are scoped; changes revoke sessions and create audit rows. Deletion awaits DEC-14. |
| T-020 | Reporting/moderation | Synthetic revenue reconciliation, queue denial, seeded report decision and replay | Metrics label synthetic revenue; admin moderation decisions are audited and repeated decisions conflict. |
| T-021 | Community | Nested posts, report and moderation, announcements, in-app/email delivery and retry | Enrolled students can thread/reply/report; owner/admin moderation scoped; outbox replay gives one in-app notification and provider dedupe where supported. |
| T-022 | Cross-cutting | WCAG manual/automated, themes/locales, cache invalidation and rate limit buckets | Both themes pass planned accessibility checks, default locale fallback works, cache expires/invalidates and all buckets throttle. |
| T-023 | Release pipeline | CI outputs, staged digests, smoke, traces and secret isolation | CI checks all services and staging smoke records deployed digest. |
| T-024 | Load, fault and restore | 100-VU API workload, concurrent AI fault, Redis recovery, PITR and denial tests | Archive load, denial, outage and restore evidence and fix release blockers. |
| T-025 | Submission | Three role journeys, smoke, rollback record and scope review | Promote smoke-tested digests, run all three role journeys and capture evidence and rollback target. |

### Accessibility and load

Check WCAG 2.1 AA across student, instructor and admin pages in both themes. Run automated scans for accessible names and color contrast, then keyboard-only and screen-reader passes for navigation, focus order/return, labels, status messages, form errors, player controls and forum dialogs. Include captions for prerecorded video, zoom/reflow and reduced-motion behavior. Archive page and criterion results with browser and assistive technology versions. [WCAG 2.1](https://www.w3.org/TR/WCAG21/).

Use k6 against production-like staging with 100 authenticated virtual users, realistic course and enrollment fixtures (proposed 100 courses and 1,000 learners), a five-minute ramp and 15-minute steady window. Mix 50% catalog/course reads, 25% dashboard/progress, 15% assessment reads/writes and 10% auth/admin paths using distributed session/IP identities without bypassing limits. Exclude AI generation and video transfer from the non-AI API target. Record per-route and overall p95, errors, request volume, cache hit rate, pools and warm/cold results. Repeat with AI unavailable and with two core replicas. Record intentional throttle tests separately.

## Targets and evidence

| Source | Target | Evidence method |
|---|---|---|
| §2.3 | Completion +25% vs no-AI control | Prospective randomized comparable cohort with same course and completion window. Compare relative uplift (treatment − control)/control, with counts and interval. Requires a live course-length observation and sample-size plan. |
| §2.3 | Average doubt resolution under 10 seconds | Time from client submit to rendered validated reply with representative questions and provider load. Record mean, tail, sample size, failures and fallback separately. Controlled staging observation is preliminary. |
| §2.3 | At least 85% generated quizzes usable without edits | Blinded instructor review of a representative sample, proposed 40 drafts across lecture topics. Count entire drafts usable without edits over all drafts. Require factual, answerable questions, correct keys, source support and appropriate difficulty. Archive rubric and model/prompt revisions. |
| §2.3 | At least 40% seven-day streak retention | Count eligible new student cohort with seven consecutive UTC active days starting at first activity divided by cohort size. Requires at least seven observation days per learner and live cohorts. Definition awaits confirmation. |
| §§2.3, 6 | Non-AI p95 below 300 ms under 100 concurrent users | k6 workload above, with load configuration, errors and p95 traces attached. |
| §6 | 99.5% core uptime excluding AI | External one-minute synthetic core probe over rolling 30 days. Count successful checks / eligible checks, record incidents and monitoring gaps. Requires live observation. |
| §6 | WCAG 2.1 AA | Automated plus manual criterion evidence and documented remediation. |

Report build/revision, environment, fixture seed, commands, results and known gaps in the [submission evidence index](DEMO_AND_SUBMISSION.md#evidence-index). Synthetic fixtures validate calculation and workflow behavior. Product targets require the observations above.

# Project requirements

The [approved LMS-AI PRD v1.0](../Document/Project%20Document.docx) governs scope. VertexLearn AI is the workspace name. Ananya needs private learning and after-hours help. Rohit authors material and monitors where students struggle. Meera oversees approval, accounts, reported content and reporting. Their shared workflow runs from instructor authoring through admin approval and student learning to completion and reporting.

Original IDs retain their PRD priorities. Derived IDs identify unnumbered baseline clauses. Design decisions and unresolved policies live in [Decisions](DECISIONS.md). The [first slice](IMPLEMENTATION_PLAN.md) is a subset of this release inventory.

## Functional baseline and derived scope

| ID | PRD § | Priority or state | Requirement |
|---|---|---|---|
| FR-S1 | 5.1 | P0 | User can register/login via email+password with JWT session issuance |
| FR-S2 | 5.1 | P0 | Student dashboard shows enrolled courses, % progress per course, streak counter |
| FR-S3 | 5.1 | P0 | Course catalog supports category, difficulty, and rating filters + search |
| FR-S4 | 5.1 | P0 | Video player supports resume-from-last-position and playback speed control |
| FR-S5 | 5.1 | P1 | Student can create timestamped notes and bookmarks on any lecture |
| FR-S6 | 5.1 | P0 | Student can upload assignment files (PDF/ZIP/code) before a deadline |
| FR-S7 | 5.1 | P0 | Quiz engine supports MCQ, multi-select, short-answer with auto-grading for objective types |
| FR-S8 | 5.1 | P1 | On 100% module completion, system auto-generates a downloadable certificate (PDF) |
| FR-S9 | 5.1 | P2 | Badges awarded on milestones (first course completed, 7-day streak, quiz perfect score) |
| FR-S10 | 5.1 | P1 | Recommendation widget suggests next course/topic based on quiz performance |
| FR-A1 | 5.2 | P0 | Chat interface lets a student ask a question about the current course |
| FR-A2 | 5.2 | P0 | AI response grounded only in that course's ingested material via RAG, with source citation |
| FR-A3 | 5.2 | P0 | AI can summarize a selected lecture transcript into key points |
| FR-A4 | 5.2 | P1 | AI generates a personalized study plan from a student's quiz score history |
| FR-A5 | 5.2 | P1 | AI auto-generates a quiz (5–10 questions) from a lecture transcript for instructor review |
| FR-A6 | 5.2 | P1 | AI adjusts explanation depth: Beginner / Intermediate / Advanced |
| FR-A7 | 5.2 | P2 | AI generates flashcards (Q/A pairs) per module for spaced revision |
| FR-A8 | 5.2 | P1 | System tracks per-topic mastery score, feeding difficulty adjustment for chat and quizzes |
| FR-I1 | 5.3 | P0 | Instructor can create a course with title, description, category, thumbnail, pricing tier |
| FR-I2 | 5.3 | P0 | Instructor can upload video/PDF/slide material per module/lecture |
| FR-I3 | 5.3 | P0 | Instructor can create assignments with rubric and deadline |
| FR-I4 | 5.3 | P0 | Instructor can build or approve AI-generated quizzes |
| FR-I5 | 5.3 | P1 | Instructor analytics dashboard shows per-lecture drop-off, avg. quiz score, time-on-task |
| FR-I6 | 5.3 | P2 | Instructor can post announcements visible to all enrolled students |
| FR-AD1 | 5.4 | P0 | Admin can approve/reject a newly submitted course before it is publicly listed |
| FR-AD2 | 5.4 | P0 | Admin can view/suspend/delete user accounts |
| FR-AD3 | 5.4 | P1 | Admin dashboard shows platform-wide metrics: DAU, enrollments, completion rate, revenue |
| FR-AD4 | 5.4 | P0 | Admin can assign/revoke roles (student/instructor/admin) |
| FR-AD5 | 5.4 | P2 | Admin can moderate reported forum posts/comments |
| SCOPE-AUTH | 3.1 | Derived | JWT auth and role-based workspace access |
| SCOPE-LEARNING | 3.1 | Derived | Dashboard, catalog, enrollment and progress |
| SCOPE-VIDEO | 3.1 | Derived | Pre-recorded video with chunked/progressive delivery |
| SCOPE-ASSESS | 3.1 | Derived | Notes, bookmarks, assignment and quiz workflows (also TASK-008 and TASK-010) |
| SCOPE-AWARDS | 3.1 | Derived | Automatic PDF certificates, streaks and badges |
| SCOPE-TUTOR | 3.1 | Derived | Course-specific contextual RAG chat |
| SCOPE-AI-TOOLS | 3.1 | Derived | Summaries, flashcards and quiz generation (also TASK-017) |
| SCOPE-MODES | 3.1 | Derived | Three explanation depths |
| SCOPE-RECS | 3.1 | Derived | Rules plus embedding similarity |
| SCOPE-INSTRUCTOR | 3.1 | Derived | Authoring, material upload and analytics (also TASK-004 and TASK-007) |
| SCOPE-ADMIN | 3.1 | Derived | Account, role and course governance, analytics and moderation (also TASK-020 and TASK-021) |
| SCOPE-FORUM | 3.1 | Derived | Course-threaded discussions |
| SCOPE-NOTIFY | 3.1 | Derived | In-app and email notifications, visible only while the recipient retains access to the approved course |
| SCOPE-UI | 3.1 | Derived | Dark mode and English-only interface |
| NFR-PERF | 6 | Derived | Non-AI API p95 below 300 ms under 100 concurrent users |
| NFR-SCALE | 6 | Derived | Stateless horizontal service scaling behind load balancer |
| NFR-AUTH | 6 | Derived | Hashed passwords, short-lived access JWT, refresh, RBAC and validated inputs |
| NFR-UPTIME | 6 | Derived | 99.5% core service uptime excluding AI |
| NFR-PRIVACY | 6 | Derived | Encrypt student PII at rest and retain audit access records |
| NFR-A11Y | 6 | Derived | WCAG 2.1 AA |
| NFR-OBS | 6 | Derived | Structured logs, traces and service health endpoints |
| NFR-CACHE | 6 | Derived | Redis catalog, course metadata and leaderboard caching |
| NFR-RATE | 6 | Derived | Auth and AI chat rate controls by user/account and IP |
| DATA-STORE | 7.1–7.3 | Derived | PostgreSQL authoritative data, pgvector embeddings, Redis cache and queues, PRD entities and indexes |
| API-AUTH | 8.1 | Derived | Auth routes and session contract |
| API-COURSES | 8.2 | Derived | Catalog, authoring, material upload and approval contracts |
| API-PROGRESS | 8.3 | Derived | Enrollment, progress and annotation contracts |
| API-ASSESS | 8.4 | Derived | Assignment, grading and quiz contracts |
| API-AI | 8.5 | Derived | Chat, summary, generation, flashcard, plan and mode contracts |
| API-REWARDS | 8.6 | Derived | Recommendation, badge, streak and leaderboard contracts |
| API-ADMIN | 8.7 | Derived | Governance, analytics and moderation contracts |
| API-ERROR | 8.8 | Derived | Standard error envelope |
| API-LIMIT | 8.9 | Derived | Auth 10/min/IP, chat 20/min/user, other authenticated 100/min/user |
| SYS-COMPONENTS | 9.1 | Derived | Gateway, core, AI and notification worker with storage and provider boundaries |
| SYS-RAG | 9.2 | Derived | Embed, retrieve course chunks, generate, persist citations and enqueue mastery |
| JOB-TRANSCRIBE | 9.3 | Derived | Transcribe video on upload |
| JOB-EMBED | 9.3 | Derived | Chunk and embed new lecture material |
| JOB-RECOMMEND | 9.3 | Derived | Recalculate recommendations nightly |
| JOB-STREAK | 9.3 | Derived | Evaluate streaks daily |
| JOB-CERT | 9.3 | Derived | Render PDF on completion |
| JOB-NOTIFY | 9.3 | Derived | Dispatch email and notifications |
| SYS-CACHE | 9.4 | Derived | Catalog TTL five minutes, leaderboard 60 seconds, CDN for video/static assets |
| ROLE-STUDENT | 11 | Derived | Student enrollment, learning and tutor access restricted to self and enrollment |
| ROLE-INSTRUCTOR | 11 | Derived | Instructor authoring, review, grading, analytics and moderation restricted to own courses |
| ROLE-ADMIN | 11 | Derived | Admin governance, course operations, review, grading, analytics and moderation |
| ROLE-ENFORCE | 11 | Derived | Role at middleware, ownership and enrollment in service |
| PLAN-W1 | 12 | Derived | Week 1 foundation and first slice with days 6–7 buffer |
| PLAN-W2 | 12 | Derived | Week 2 complete learning loop with days 13–14 buffer |
| PLAN-W3 | 12 | Derived | Week 3 cited AI tools with days 20–21 buffer |
| PLAN-W4 | 12 | Derived | Week 4 production demo and green pipeline |
| STACK-UI | 13 | Derived | React 18, TypeScript, Vite, state, styling and query client |
| STACK-CORE | 13 | Derived | Node/Express, PostgreSQL, Redis, storage, queues, authentication and video |
| STACK-AI | 13 | Derived | FastAPI, Anthropic, pgvector and STT |
| STACK-QA | 13 | Derived | Automated verification, structured logs and metrics |
| OPS-ENV | 14.1 | Derived | Compose locally, production-like staging and managed production |
| OPS-CI | 14.2 | Derived | PR checks, main-to-staging smoke and tagged promotion |
| OPS-INFRA | 14.3 | Derived | TLS edge, managed data, object lifecycle, CDN and secrets |
| OPS-SCALE | 14.4 | Derived | Isolated stateless services, read caching and replica trigger |
| OPS-ROLLBACK | 14.5 | Derived | Redeploy known-good immutable image |
| TOOLS-DEV | 16.1 | Derived | Development runtime, containers, Git and database clients |
| TOOLS-QA | 16.2 | Derived | API, automated test and load tools |
| TOOLS-CLOUD | 16.3 | Derived | Cloud, registry, DNS/domain and TLS accounts |
| TOOLS-AI | 16.4 | Derived | Anthropic and embedding credentials and pgvector |
| TOOLS-DESIGN | 16.5 | Derived | Wireframes, diagrams and versioned docs |
| TOOLS-OPS | 16.6 | Derived | APM, centralized logging and uptime tooling |
| KPI-COMPLETION | 2.3 | Derived | Completion +25% vs no-AI control |
| KPI-LATENCY | 2.3 | Derived | Average AI doubt resolution under 10 seconds |
| KPI-QUIZ | 2.3 | Derived | At least 85% of generated quizzes usable without edits |
| KPI-STREAK | 2.3 | Derived | At least 40% seven-day streak retention |
| FUT-01 | 3.2, 15 | Deferred | Live classes and collaborative whiteboard |
| FUT-02 | 3.2, 15 | Deferred | Peer study rooms and matchmaking |
| FUT-03 | 3.2, 15 | Deferred | AI plagiarism detection (extension point only in v1) |
| FUT-04 | 3.2, 15 | Deferred | Payment gateway, subscriptions, purchases and payouts |
| FUT-05 | 3.2, 15 | Deferred | Native apps |
| FUT-06 | 3.2, 15 | Deferred | Offline sync |
| FUT-07 | 3.2, 15 | Deferred | Full translation and regional-language tutor |
| FUT-08 | 15 | Deferred | Cohort and at-risk analytics |
| FUT-09 | 15 | Deferred | Marketplace coupons, affiliates and payout dashboards |
| FUT-10 | 15 | Deferred | Adaptive module reordering |
| FUT-11 | 15 | Deferred | Voice tutor |
| FUT-12 | 15 | Deferred | SSO/SAML |

See [traceability](TRACEABILITY_MATRIX.md) and [target measurement](TESTING_STRATEGY.md).

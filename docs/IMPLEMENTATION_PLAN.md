# Four-week implementation plan

One full-stack developer at approximately 6–7 focused hours per day. The [ordered backlog](TASKS.md) contains the §12 day-by-day assignments. Start tests with each feature and close the browser journey during each buffer. Keep the last working increment runnable each day.

| Week | PRD schedule | Weekly demo and definition of done | Dependencies and risk |
|---|---|---|---|
| 1 | Day 1 repo, Compose and CI · 2 schema · 3 auth · 4 course CRUD and catalog · 5 frontend scaffold · 6–7 dashboard/catalog and buffer | Registration and login work. Instructor creates a course, admin fixture approves it, student browses and enrolls, dashboard persists on reload. | Local PostgreSQL, Redis and role fixtures. Build minimal approval/enrollment with course CRUD. |
| 2 | 8 media · 9 progress/notes/bookmarks · 10 assignments · 11 quizzes · 12 certificates/badges/streaks · 13–14 analytics and buffer | Enrolled student watches and resumes, saves note, submits work, takes quiz and downloads one PDF. Instructor grades and reconciles fixture analytics. | Week 1 identity and course boundary. Verify a short HLS asset with signed playback early. |
| 3 | 15 AI runtime · 16 ingestion · 17 cited chat · 18 summaries and flashcards · 19 quiz drafts · 20–21 modes/mastery/plans/recommendations and buffer | Student gets a cited answer and grounded learning tools. Instructor approves draft. Cross-course and provider outage checks pass. | Week 2 media, transcripts and assessment data. Verify provider quota and model before Day 15. |
| 4 | 22 admin · 23 analytics and moderation · 24 forum, announcements and notifications · 25 themes, accessibility, i18n and controls · 26 staging · 27 load/security · 28 production demo | Three role journeys pass in deployed demo, governance verified, CI green, staging evidence and rollback digest recorded. | Accounts and DNS before Day 26. Seed reports on Day 23. Keep a smoke-tested digest. |

## First slice

Bootstrap repo, CI, Compose, PostgreSQL migrations, Redis and seeded roles. Implement sign-in → instructor creates → admin-approved course appears → student enrolls → dashboard shows persisted enrollment. Test pending visibility, role denial, concurrent enrollment and reload. The [full scope](PROJECT_REQUIREMENTS.md) governs subsequent work.

Each task requires its acceptance check, denial and failure-path coverage where applicable, contract or migration updates, and evidence links. Each week ends with a repeatable seeded demo and passing checks. Days 6–7, 13–14 and 20–21 retain testing and overrun buffers. Record schedule impact if a buffer is exhausted.

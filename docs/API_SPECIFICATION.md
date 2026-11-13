# REST API specification

The [OpenAPI 3.0 contract](api-spec.yaml) contains all 40 documented §8 operations and workflow extensions. The base path is `/api/v1`. Curly-brace path parameters correspond to PRD colon parameters. The YAML file is generated separately from this inventory. Public catalog responses contain approved metadata. Private lesson assets require enrollment and short-lived access grants. The [permission matrix](SECURITY.md) applies in addition to the role summaries below.

## Operation inventory

| Method | Path relative to base | PRD § or proposed | Access | Success |
|---|---|---|---|---|
| POST | `/auth/register` | 8.1 | public | 201 |
| POST | `/auth/login` | 8.1 | public | 200 |
| POST | `/auth/refresh` | 8.1 | refresh | 200 |
| POST | `/auth/logout` | 8.1 | refresh | 204 |
| GET | `/auth/me` | 8.1 | user | 200 |
| GET | `/courses` | 8.2 | public | 200 |
| GET | `/courses/{id}` | 8.2 | public | 200 |
| POST | `/courses` | 8.2 | author | 201 |
| PUT | `/courses/{id}` | 8.2 | owner | 200 |
| POST | `/courses/{id}/modules` | 8.2 | owner | 201 |
| POST | `/modules/{id}/lectures` | 8.2 | owner | 201 |
| POST | `/courses/{id}/approve` | 8.2 | admin | 200 |
| POST | `/courses/{id}/enroll` | 8.3 | student | 200 |
| GET | `/enrollments/me` | 8.3 | student | 200 |
| POST | `/lectures/{id}/progress` | 8.3 | enrolled | 200 |
| POST | `/lectures/{id}/notes` | 8.3 | enrolled | 201 |
| POST | `/lectures/{id}/bookmarks` | 8.3 | enrolled | 201 |
| POST | `/assignments` | 8.4 | owner | 201 |
| POST | `/assignments/{id}/submit` | 8.4 | enrolled | 201 |
| PUT | `/submissions/{id}/grade` | 8.4 | owner | 200 |
| POST | `/quizzes` | 8.4 | owner | 201 |
| POST | `/quizzes/{id}/attempt` | 8.4 | enrolled | 201 |
| POST | `/attempts/{id}/submit` | 8.4 | self | 200 |
| POST | `/ai/chat/sessions` | 8.5 | tutor | 201 |
| GET | `/ai/chat/sessions?course_id={id}` | TASK-015 | tutor | 200 |
| POST | `/ai/chat/sessions/{id}/messages` | 8.5 | tutor | 200 |
| POST | `/ai/chat/sessions/{id}/messages/{requestId}/mastery` | TASK-018 | enrolled student | 200 |
| GET | `/users/me/mastery?course_id={id}` | TASK-018 | enrolled student | 200 |
| GET | `/courses/{id}/topics` | TASK-018 | owner/admin or enrolled student | 200 |
| POST | `/courses/{id}/topics` | TASK-018 | owner/admin | 201 |
| GET | `/modules/{id}/topics` | TASK-018 | module owner/admin | 200 |
| POST | `/ai/lectures/{id}/summarize` | 8.5 | enrolled | 200 |
| POST | `/ai/lectures/{id}/generate-quiz` | 8.5 | owner | 202 |
| POST | `/ai/modules/{id}/flashcards` | 8.5 | enrolled | 200 |
| POST | `/ai/study-plan` | 8.5 | enrolled | 200 |
| GET | `/users/me/flashcards` | TASK-016 | enrolled | 200 |
| POST | `/users/me/flashcards/{id}/review` | TASK-016 | self | 200 |
| GET | `/users/me/ai-usage` | TASK-015 | self | 200 |
| PUT | `/ai/chat/sessions/{id}/mode` | 8.5 | tutor | 200 |
| GET | `/recommendations/me` | 8.6 | student | 200 |
| GET | `/users/me/badges` | 8.6 | student | 200 |
| GET | `/users/me/streak` | 8.6 | student | 200 |
| GET | `/leaderboard/{courseId}` | 8.6 | member | 200 |
| GET | `/admin/users` | 8.7 | admin | 200 |
| PUT | `/admin/users/{id}/role` | 8.7 | admin | 200 |
| PUT | `/admin/users/{id}/suspend` | 8.7 | admin | 200 |
| GET | `/admin/courses/pending` | 8.7 | admin | 200 |
| GET | `/admin/analytics/overview` | 8.7 | admin | 200 |
| GET | `/admin/moderation/flagged-posts` | 8.7 | admin | 200 |
| POST | `/courses/{id}/submit` | Proposed | owner | 200 |
| DELETE | `/courses/{id}` | Proposed | owner | 204 |
| GET | `/instructor/courses` | Proposed | author | 200 |
| GET | `/instructor/courses/{id}` | Proposed | owner | 200 |
| GET | `/lectures/{id}/playback` | Proposed | enrolled | 200 |
| GET | `/lectures/{id}/progress` | Proposed | enrolled | 200 |
| GET | `/lectures/{id}/resources/{resourceId}` | Proposed | enrolled | 200 |
| GET | `/lectures/{id}/notes` | Proposed | enrolled | 200 |
| GET | `/lectures/{id}/bookmarks` | Proposed | enrolled | 200 |
| GET | `/courses/{id}/assignments` | Proposed | member | 200 |
| GET | `/assignments/{id}/submissions` | Proposed | member | 200 |
| GET | `/submissions/{id}/file` | Proposed | member | 200 |
| GET | `/modules/{id}/quizzes` | Proposed | member | 200 |
| GET | `/quizzes/{id}/review` | Proposed | owner | 200 |
| PUT | `/quizzes/{id}` | Proposed | owner | 200 |
| POST | `/quizzes/{id}/review` | Proposed | owner | 200 |
| GET | `/quizzes/{id}/attempts` | TASK-010 | member | 200 |
| GET | `/attempts/{id}` | Proposed | self | 200 |
| PUT | `/attempts/{id}/grade` | Proposed | owner | 200 |
| GET | `/users/me/certificates` | Proposed | student | 200 |
| GET | `/certificates/{id}/download` | Proposed | self | 200 |
| GET | `/certificates/{id}/verify` | Phase 8 | public | 200 |
| GET | `/certificates/{id}/public-download` | Phase 8 | public | 200 |
| GET | `/users/me/badges` | TASK-011 | student | 200 |
| GET | `/users/me/streak` | TASK-011 | student | 200 |
| GET | `/ai/jobs/{id}` | Proposed | owner | 200 |
| GET | `/ai/chat/sessions/{id}/messages` | Proposed | tutor | 200 |
| GET | `/instructor/courses/{id}/analytics` | TASK-012/Phase 4 | owner | 200 |
| GET | `/admin/analytics/overview` | TASK-012 | admin | 200 |
| POST | `/ai/lectures/{id}/ingest` | TASK-014 | owner | 202 |
| POST | `/ai/jobs/{id}/publish` | TASK-014 | owner | 200 |
| GET | `/ai/jobs/{id}` | TASK-014 | owner/member | 200 |
| GET | `/ai/health` | TASK-013 | public | 200/503 |
| DELETE | `/admin/users/{id}` | Proposed | admin | 204 |
| GET | `/courses/{id}/threads` | Proposed | member | 200 |
| POST | `/courses/{id}/threads` | Proposed | member | 201 |
| GET | `/threads/{id}/posts` | Proposed | member | 200 |
| POST | `/threads/{id}/posts` | Proposed | member | 201 |
| POST | `/posts/{id}/report` | Proposed | member | 201 |
| PUT | `/posts/{id}/moderation` | Proposed | moderator | 200 |
| GET | `/courses/{id}/announcements` | Proposed | member | 200 |
| POST | `/courses/{id}/announcements` | Proposed | owner | 201 |
| GET | `/notifications/me` | Proposed | user | 200 |
| PUT | `/notifications/{id}/read` | Proposed | self | 200 |

## Validation and retries

Validate path and body UUIDs, content type, enum values, text bounds and cross-resource relationships before acting. Reject unknown write fields, partial rubric scores, duplicate option IDs, foreign question options and invalid progress intervals. Course titles max 200, category max 80, full name max 150 and auth email max 180. Course filters compose, rating is 0–5, and search uses parameterized SQL. Use page starting at 1 and limit default 20, maximum 100. Response lists return items/page/limit/total where pagination applies. Stable sort appends ID to the primary timestamp or rank.

An idempotent POST with the same principal, route, key and payload returns its first successful response. Changed payload returns 409. Scope keys to caller and operation for 24 hours, with database uniqueness protecting domain invariants after expiry. Progress dedupes by event ID and enrollment by user/course. Versioned writes use ETag and If-Match. Obtain revisions from the corresponding read, create or list item metadata. For pending courses, the default pending status is retained and submitted_at controls review eligibility. DELETE course means archive. DELETE user is an audited lifecycle transition with privacy processing. Private file URLs expire within five minutes.

The proposed assignment submit transport is multipart. A 201 means safe file durably attached and deadline checked. The PRD quiz-submit contract still returns an objective score immediately, with final score available only after short-answer review. Quiz generation returns 202 with a job ID, and a pending job never publishes a quiz. See [grading](ASSESSMENTS_AND_GRADING.md).

## Errors and throttling

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "email must be a valid email address",
    "field": "email"
  }
}
```

Use 400 for malformed shape, 401 for invalid credentials, 403 for role or enrollment denial, 404 for absent or concealed resources, 409 for competing state/revisions, 413 for size, 415 for media type, 422 for domain validation, 429 for throttling and 503 for dependency unavailability. Codes stay machine-readable and messages omit secrets. Return Retry-After for throttling and temporary dependency failures when known.

Apply §8.9 route groups before auxiliary controls. Auth endpoints use 10/min/IP. Chat uses 20/min/user. Other authenticated endpoints use 100/min/user. Proposed auxiliary limits are 10/min per normalized auth account or session identity and 120/min/IP on chat. Match the most specific route group, apply all applicable buckets and use a trusted edge IP. Set separate bounded budgets for anonymous catalog, uploads and non-chat AI jobs.

## PRD chat example

`POST /api/v1/ai/chat/sessions/{id}/messages`

```json
{
  "message": "Why does quicksort degrade to O(n^2) on sorted input?"
}
```

200 response with a synthetic UUID replacing the PRD placeholder.

```json
{
  "reply": "Because the pivot chosen (commonly the first or last element)...",
  "sources": [
    {
      "lecture_id": "00000000-0000-4000-8000-000000000842",
      "lecture_title": "Sorting Algorithms - Part 2",
      "timestamp_seconds": 842
    }
  ],
  "mode": "intermediate"
}
```

Source timestamps are optional when unavailable. Insufficient course evidence returns a bounded fallback with an empty source list and current mode. Provider failure returns 503. The PRD login shape is email/password → access_token, refresh_token and user containing id, full_name and role. See [security](SECURITY.md) for token rotation and [AI tutor](AI_TUTOR.md) for source validation.

For each chat request, the service loads up to ten prior messages from that actor-owned session; clients do not submit history. The AI adapter caps history at 4,000 characters per message and 12,000 characters total, and treats it as conversational context rather than factual evidence. See [AI routes](../backend/src/modules/ai/routes.ts), [AI service](../ai-service/app/main.py) and planned [T-015 checks](TESTING_STRATEGY.md#test-register).

`GET /ai/chat/sessions?course_id={uuid}` lists only the authenticated actor's sessions after tutor-scope checks. `GET /ai/chat/sessions/{id}/messages` restores the persisted conversation and authoritative citations. `GET /users/me/ai-usage` reports the actor's current-month provider request and token totals without returning prompt content.
## Foundation endpoints

TASK-003 implements the five `/auth` operations. TASK-004 implements catalog list and detail, course create and update, course review, enrollment creation and the current student's enrollment list. See [auth routes](../backend/src/modules/auth/routes.ts), [course and enrollment routes](../backend/src/modules/courses/routes.ts) and [integration checks](../backend/test/foundation.test.js).

In the foundation, creating or editing a course submits that revision for admin review and hides it from the public catalog while pending. The admin supplies the current ETag and an idempotency key to review. Rating aggregates can be set by synthetic test fixtures. The production source remains open under [DEC-10](DECISIONS.md). Course details include module and lecture metadata.

## Learning and assessment endpoints

TASK-006 adds the instructor course list/detail and the browser enrollment walkthrough. The demo approval command calls the existing review policy. TASK-007 adds module and lecture authoring, optional WebVTT captions, and signed playback and resource links. The playback response includes a playback ID for heartbeat sequencing. The playlist, segments, captions and resource downloads validate the grant and current session and enrollment. See the [learning routes](../backend/src/modules/learning/routes.ts).

TASK-008 adds progress, notes and bookmarks. Heartbeats merge valid ranges as a union and update resume by playback session and sequence. Lecture completion requires 100% unique coverage. Progress tracking records unique watch percentage, rewatch counts, drop-off position and last watched timestamp. A replayed event cannot add coverage. Annotations are private to their author. See the [progress service](../backend/src/modules/learning/progress.ts). Instructor analytics provides course-level and per-lecture video engagement, watch percentage, drop-off points, and rewatch metrics.

TASK-009 adds assignment creation, private submission, rubric grading and signed download. TASK-010 adds quiz drafts, versioned review, learner attempts, objective scoring and short-answer review. The attempt list gives learners their own status and scores. It gives the owning instructor or admin the pending short-answer review queue. See the [assignment routes](../backend/src/modules/assignments/routes.ts), [quiz routes](../backend/src/modules/quizzes/routes.ts) and [integration checks](../backend/test/learning.test.js).

## AI learning tools, personalization and administration

- `POST /ai/lectures/{id}/summarize` requires an enrolled student and returns a transcript-only summary with validated source chunk references.
- `POST /ai/modules/{id}/flashcards` requires an enrolled student and uses active chunks from that module only.
- Generated cards are saved to the learner's private deck. `GET /users/me/flashcards?course_id={uuid}` lists cards only for currently enrolled courses; `POST /users/me/flashcards/{id}/review` advances the card's due date by one day.
- `POST /ai/lectures/{id}/ingest` combines owner-supplied transcript/notes with the lecture's validated PDF, PPTX and WebVTT assets, chunks the source while retaining page/slide/time metadata, embeds the generation and leaves a separate publish action.
- `POST /ai/modules/{id}/quiz-draft` requires the course instructor or admin and an `Idempotency-Key`; it creates a private AI quiz draft with 5–10 evidence-checked questions. A retry returns the same draft. Existing `GET /quizzes/{id}/review` and `POST /quizzes/{id}/review` provide instructor review and approval.
- `POST /courses/{id}/topics` and `GET /courses/{id}/topics` are owner/admin scoped for edits and reads; enrolled students may read topic names for tutor check-ins. `GET /modules/{id}/topics` returns only topics for an owned module. Quiz questions may map to a course topic, and mismatched course topics are rejected. `GET /users/me/mastery?course_id={id}` returns enrolled course topics with mastery, confidence, evidence timestamp and band; omit the filter to list topics across enrolled courses. Finalized quiz scores and explicit learner tutor check-ins feed deterministic mastery replay. Tutor check-ins are private, idempotent and tied to a saved response; they never infer understanding from chat text. The study plan stores and returns a seven-day UTC schedule with daily time estimates.
- `GET /admin/courses/pending`, `GET /admin/users`, `PUT /admin/users/{id}/roles` and `POST /admin/users/{id}/suspend` require admin. Role and suspension changes revoke sessions and write audit rows.
- `GET /admin/analytics/overview` reports DAU, enrollments, completion rate and synthetic payment revenue. `GET /admin/moderation/reports` and `POST /admin/moderation/reports/{id}/review` require admin.

`DELETE /admin/users/{id}` is prepared behind `ACCOUNT_DELETION_POLICY_CONFIRMED=true`. It is unavailable until DEC-14 is confirmed; the environment flag is not itself policy approval. The proposal anonymizes profile PII immediately, removes private learner content, revokes sessions, and retains a pseudonymous tombstone and redacted audit history. AI provider calls still require the DEC-09 `AI_OUTBOUND_DATA_APPROVED=true` operational gate. Note that [admin routes](../backend/src/modules/admin/routes.ts) implement `PUT /admin/users/{id}/roles` (supporting a validated role list) alongside the §8.7 `/admin/users/{id}/role` baseline in the inventory above.

## Community, caching, throttling and observability

- [Discussion & announcement routes](../backend/src/modules/discussions/routes.ts) implement `GET/POST /courses/{id}/threads`, `GET/POST /threads/{id}/posts` (enforcing same-thread `parent_id` via composite foreign key), `POST /posts/{id}/report` (synchronizing into `moderation_reports`), `PUT /posts/{id}/moderation` (ETag `If-Match`, owner/admin scoped, masking hidden post bodies to learners as `[Hidden by moderation]`), and `GET/POST /courses/{id}/announcements`.
- [Notification routes](../backend/src/modules/notifications/routes.ts) implement `GET /notifications/me` and `PUT /notifications/{id}/read`, backed transactionally by the PostgreSQL [outbox](../backend/src/jobs/outbox.ts), Redis list queue, deduplicated [email dispatcher](../backend/src/jobs/email.ts), and standalone [worker entrypoint](../backend/src/jobs/worker.ts).
- Course-scoped in-app notifications are returned and can be marked read only while the recipient is an enrolled student, the course instructor, or an admin and the course is approved. Course-independent notices remain visible to their recipient.
- [Catalog & course caching](../backend/src/modules/courses/service.ts) uses Redis TTL `300s` keyed by PostgreSQL `cache_generations` (`catalog`), invalidating on course create, update, approval/rejection, and DSA seeding. `GET /leaderboard/{courseId}` in [gamification routes](../backend/src/modules/gamification/routes.ts) caches redacted rankings (`display_name`, `rank`, `score` only; omitting emails and user IDs) for `60s` and invalidates on enrollment, completion progress, assignment grading, and quiz grading, falling back to single-flight PostgreSQL queries when Redis is unavailable.
- [Rate limiting](../backend/src/middleware/rateLimit.ts) enforces `auth-ip` (`10/min/IP`), `auth-account` (`10/min/account`), `catalog-ip` (`120/min/IP`, fail-open), `user` (`100/min/user`), `upload` (`20/min/user`), `ai-chat` (`20/min/user`), `ai-chat-ip` (`120/min/IP`), and `ai-jobs` (`30/min/user`) with `TRUST_PROXY` (`app.set('trust proxy', ...)`) and `Retry-After` response headers.
- [Service health and metrics](../backend/src/app.ts) expose `GET /health/live`, `GET /health/ready` (checking PostgreSQL and Redis independently of AI), and `GET /metrics` (Prometheus text exposition via [metrics helpers](../backend/src/utils/metrics.ts), blocked at the [NGINX edge](../infra/nginx.conf) with `403`). Request telemetry flows through the PII/secret-redacting JSON [logger](../backend/src/utils/logger.ts).

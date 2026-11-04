# Personalization and analytics

These metric definitions and weights are proposed. All windows use UTC and half-open [from, to) intervals. Keep versioned event schemas, event IDs, actor/course/topic scope and server acceptance timestamps. Store facts in PostgreSQL and rebuild projections deterministically.

## Mastery and recommendations

Tag lectures and approved questions with course-owned topics. Start mastery at 0.50 with low confidence. On a finalized topic score p in [0,1], set mastery to 0.8 × old + 0.2 × p. Grade corrections replace the earlier event contribution and replay in stable order. Tutor interaction records topic and engagement. Unverified questions or generated claims do not prove mastery. Explicit answer evidence from tutor checks can contribute at weight 0.05 after validation. Deduplicate by learner, topic and evidence ID. Serialize updates per learner/topic or rebuild deterministically.

Use beginner below 0.40, intermediate from 0.40 through below 0.75, and advanced from 0.75. Chat mode override wins. Quiz selections use published bank items of appropriate difficulty with a deterministic adjacent-band fallback. Study plans prioritize lowest mastery with finalized quiz history and link to accessible lectures.

Generate next-topic candidates in enrolled courses, and next-course candidates from approved, unenrolled catalog. Filter for prerequisites where seeded and exclude inaccessible courses. Normalize cosine similarity to 0–1, combine 60% rule score for weakness/readiness and 40% similarity between learner topic profile and candidate descriptions. Cold start uses category preferences or catalog defaults with an explicit reason. Recompute nightly and after final scores, persist rank and reason, and recheck visibility on read.

## Progress and gamification

A validated playback event contributes unique watched intervals within the asset duration. Reject intervals inconsistent with elapsed playback and rate bounds. Server-issued playback sessions, event IDs and sequence avoid old-device overwrites. Store latest accepted resume position independently from unioned watched coverage. Mark required lecture complete at 90% unique coverage and completion is monotonic for its pinned curriculum snapshot. A module completes when all required lectures finish. Course progress equals completed required lectures divided by required count, with an empty curriculum at 0%. The course certificate policy is [open](DECISIONS.md). Badges are first completed course, first seven-day streak and first finalized perfect quiz. Count one active day per learner on accepted meaningful study events, such as playback, assessment or grounded tutor interaction. Evaluate streaks by consecutive UTC activity dates. Leaderboard ranks enrolled learners by best finalized score aggregate then engagement, with deterministic ties and display names only.

## Reporting definitions and fixture

| Metric | Proposed calculation | Fixture expectation |
|---|---|---|
| Lecture drop-off | 100 × (started distinct learners − completed from those starters) / starters, counted within report window. Start requires accepted playback. | 4 started and 3 completed = 25%. No starters yields no value. |
| Average quiz score | Mean of finalized attempts with final grade timestamp in the window. | 60 and 100 = 80%. Pending short-answer omitted. |
| Time-on-task | Union of valid, server-bounded real elapsed playback/activity intervals per learner; sum over learners. Cap heartbeat gaps and exclude idle time. | One learner with 0–40 and 20–60 elapsed intervals contributes 60s. |
| DAU | Distinct active student actors per UTC date. | Three events by two students = 2. |
| Enrollments | First enrollment rows created in window, deduplicated by learner/course. | Two unique pairs plus retry = 2. |
| Completion rate | Enrollments in selected cohort window completed by report cutoff divided by cohort size. | 1 of 2 = 50%. Empty cohort has no percentage. |
| Revenue | Sum successful synthetic payments for window in the seeded reporting currency. Refunded and failed rows excluded. | INR 499 + INR 999 successful, INR 499 refunded and INR 99 failed = INR 1,498 demo revenue. |

Scope instructor queries to owned courses and platform queries to admin. Reconcile dashboard results directly against SQL fixture facts. Include late-arriving events in a documented rerun with timestamped cutoff. See [testing](TESTING_STRATEGY.md) and [demo](DEMO_AND_SUBMISSION.md).

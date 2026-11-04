# Assessments and grading

## Assignments

An owning instructor or admin defines course, title, instructions, UTC deadline and rubric criteria with point maxima. Validate rubric IDs and points, and audit edits and overrides. Students must be enrolled and submit PDF, ZIP or approved code extensions as data. Stream to quarantine, validate type, scan and enforce size and archive expansion limits. Refuse symlinks, nested bombs, path traversal, active uploads and execution. A failed or abandoned upload can be retried. Accept and timestamp in the database only after clean validation and before the deadline, using server time. Display the deadline and pending scan expectation in the form.

Proposed v1 rule is one accepted submission per learner/assignment. Same request key and content replays the result, and subsequent distinct content conflicts. Release orphan objects with a cleanup worker. A locked assignment or deadline check handles races. Instructor/admin reviews via expiring private download, submits per-criterion points and feedback with If-Match. Grade = total earned / total available × 100. Preserve rubric version and grade audit. Students see only their own submission and grade. Preserve a future plagiarism-check hook after validation.

## Quizzes

Manual authors and AI generation both create drafts. The owner or admin previews with keys, edits and approves a specific revision. Rejection records reason and keeps the draft private. Publishing is atomic, and later edits fork a draft revision. Active attempts and historical grades pin their published revision. Difficulty selection uses the learner's mastery band against approved tagged questions and falls back deterministically to available approved items.

Start one active attempt per learner/quiz under a unique constraint. Return prompts and option IDs/text only. Submit locks the attempt, validates exact attempt question scope, stores answers and grades objective items in one transaction. MCQ requires one correct option. Multi-select requires exact set equality with no duplicates. Unanswered objective items score zero. Each objective item awards its full points for a correct response. The objective percentage uses objective points as denominator and is omitted for an all-short-answer attempt.

Short-answer responses are pending review. Instructor/admin grades each by rubric and publishes the final score when all questions have points. Final percentage uses all possible points. Store timestamps, reviewer and revision. Retrying the original submit replays its recorded response and cannot change the submitted answers. A new submission against a closed attempt returns conflict. Return final score through attempt read after review. Learner APIs expose aggregate scores and status. Keys, correctness flags and instructor rubrics are excluded from learner quiz, grading and tutor payloads.

## Planned acceptance checks

Verify cutoff at the exact deadline, concurrent uploads, unsupported types, ZIP traversal, out-of-range points, stale grade revision, retries, cross-course ownership, attempted use of a draft, repeated answers and option IDs from another question. Verify old attempts after publishing a new revision and confirm no learner response contains keys. See [API](API_SPECIFICATION.md) and [test register](TESTING_STRATEGY.md#test-register).

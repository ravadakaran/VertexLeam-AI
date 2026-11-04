# AI tutor

## Ingestion

After an owning instructor or admin uploads lecture material, quarantine, probe and scan it. Register an immutable source version and enqueue transcription or extraction after commit. FFmpeg extracts and splits audio into provider-safe chunks of at most 25 MB. Use managed whisper-1 with verbose JSON segment timestamps, normalize segment offsets to the lecture timeline and de-duplicate overlaps. Extract PDF and slide text with page/slide metadata in a restricted worker. Report malformed, encrypted or textless documents to the owner. Playback uses independently published HLS assets.

Split by lecture/source boundaries and transcript segments. Start with approximately 500 tokens and 75 overlap, tune against retrieval fixtures. Retain course and lecture IDs, original text, source version, chunk ordinal, segment times or page/slide, content hash and embedding model. Embed with text-embedding-3-small (1536 dimensions). Upsert staged chunks and promote the complete generation atomically. Replacing a source disables superseded chunks immediately if its content is withdrawn. Source removal invalidates new answers and generation caches. Keep citations auditable with historical source metadata and recheck access before deep-linking.

## Request and grounding

1. Core resolves the session, checks active actor and enrollment or owning instructor reviewer scope, and exchanges identity for a private service token. Session lookup binds actor and course. FastAPI verifies the service token and request scope before contacting providers.
2. Normalize and bound question/history. Embed the question and retrieve up to six diverse active chunks scoped to course and accessible lectures. Use cosine distance and an evaluation-calibrated cutoff. Scope every search, cache key and source validation by course and active corpus version.
3. Send Anthropic Messages a system instruction requiring grounded answers and chunk IDs. Treat questions, history and retrieved text as untrusted data. Exclude rubrics, keys, unpublished assessment material, student files and unrelated chat from retrieval and generation. Provide no action tools. Render only sanitized output.
4. Parse and validate reply shape, cite only retrieved IDs and map them to authoritative lecture title and timestamps. Require supporting evidence for substantive claims and use a conservative answer validator. Invalid citation or insufficient evidence returns a bounded fallback inviting the learner to rephrase or contact the instructor, with no citations. A valid-looking citation alone is insufficient for evaluation.
5. Persist paired messages, validated sources and mode against an idempotent request ID. Enqueue bounded topic evidence. A provider timeout returns 503, preserves the user's ability to retry, and creates no successful tutor reply or mastery event.

Default intermediate for learners without topic evidence. Explicit beginner/intermediate/advanced choice overrides adaptation for that session. Modes alter explanation depth and examples while source validation remains identical. Instructor reviewer sessions are independent of student chats. Admin has no chat permission under §11.

## Learning tools and review

| Tool | Inputs and safeguards | Output |
|---|---|---|
| Lecture summary | Current enrolled lecture, active transcript, versioned prompt | Key points with validated lecture citations |
| Module flashcards | Active module sources and topic map | Grounded Q/A cards for spaced revision. Screen against assessment keys. |
| Study plan | Own finalized quiz history and accessible topic map, with low-mastery priorities | Ordered steps pointing to authorized lectures/topics. Cold start offers syllabus-based steps labeled as such. |
| Quiz draft | Owner/admin and active transcript. Validate 5–10 questions, supported types, source evidence and option/rubric shape. | Private draft, job status and instructor preview. Review/edit and approve before publication. |

Cache summaries/flashcards by course, source version, model and prompt version, behind access checks. Study plans and chats are learner-private. Provider data payloads contain only necessary excerpts and scores. Apply response size, token, concurrency and spend budgets. Redact transcript and chat text from operational logs.

## Evaluation

Use a known DSA transcript with segment offsets, a near-duplicate in another course, missing sources, unanswerable prompts, adversarial lecture text, answer-key fishing and simulated timeouts. Verify role denial happens before embedding, answer claims are entailed by citations, source IDs are scoped, and missing metadata omits the timestamp. Compare explanation modes with the same evidence. Have an instructor score generated quizzes for factuality, ambiguity, grading correctness and scope before approval. See [measurement](TESTING_STRATEGY.md) and [assessment review](ASSESSMENTS_AND_GRADING.md).

# Decisions and open issues

The PRD is approved. These are proposed implementation decisions and open policy questions. Confirm open items before their affected demo gate. See the [requirements ledger](PROJECT_REQUIREMENTS.md).

| ID | PRD source and state | Proposal and trade-off | Gate |
|---|---|---|---|
| DEC-01 | §§8, 11–12 · proposed | Implement a minimal admin-only approval action in Week 1. The environment-guarded demo fixture invokes the same policy and records the actual decision. Keep the admin UI on Day 22. | Instructor-created pending courses remain private. |
| DEC-02 | FR-S8, §§7.2, 9.3 · open | Issue one course-scoped PDF when all required modules reach 100%. Use a one-module course for Week 2. If literal per-module awards are confirmed, add module_id and one award per learner/module. | Confirm before Day 12. |
| DEC-03 | §§5, 8, 11 · proposed | Add workflow routes for review, downloads, assessment reads, moderation, analytics, deletion and notifications. Preserve all original operations. | Additional contract and authorization tests. See [inventory](API_SPECIFICATION.md). |
| DEC-04 | FR-AD3, §§3.2, 7, 11 · proposed | Use synthetic single-currency payment facts with clear demo provenance. Admin sees demo revenue and billing remains deferred. | Reporting labels and reconciliation. |
| DEC-05 | FR-S7, §§7–8 · proposed | Exact-set multi-select, manual rubric for short-answer, published revisions and separate objective and final scores. AI drafts require owner/admin approval. | Grade review and answer visibility tests. |
| DEC-06 | FR-S2/S4/S8, §§7–8 · completion confirmed, certificate eligibility open | Complete a lecture at 100% unique playback, confirmed for TASK-008. Course progress averages the unique-playback percentages of video lectures pinned at the first tracked activity. Track assessments separately. | Confirm whether assessments gate certificates before TASK-011. |
| DEC-07 | FR-I5/AD3, §2.3 · open | Use UTC, distinct activity actors and first-enrollment cohorts with explicit cutoffs. | Confirm business timezone, retention cohort and denominators before analytics. |
| DEC-08 | §§7, 13 · proposed | Express keeps the core lightweight. Select Zustand, Tailwind, TanStack Query, Argon2id, pdf-lib and BullMQ with private FastAPI calls from workers. | Lock runtimes and resolved dependencies at scaffold. |
| DEC-09 | §§7, 9, 13 · proposed | Use Anthropic Messages, separate OpenAI 1536-dimension embeddings and managed Whisper. Start with exact course-filtered cosine retrieval and defer building PRD IVFFlat until representative data and recall tests. | Index rollout deviation. Confirm provider access and outbound data policy. |
| DEC-10 | FR-S3, §§7–8 · open | Use seeded rating aggregates for demo filtering. Agree a source for production ratings. | Rating submission requires scope agreement. |
| DEC-11 | §§1, 6, 9 · proposed | Centralize course scope, policy and cache keys with a deployment namespace. Add tenant membership and isolation migrations when a tenant model is approved. | Tenant onboarding and switching are future work. |
| DEC-12 | §§8.2, 11 · proposed | Apply §11 admin override for authoring, uploads, grades and quiz review. Keep instructor reviewer chat separate from student sessions. | Test §11 route exceptions. |
| DEC-13 | §14 · proposed | Use ECS Fargate and managed AWS data, CDN and monitoring services. Stage smaller with independent data. | Cloud budget, account and domain setup. |
| DEC-14 | §§6, 11 · open | Tombstone deleted accounts, revoke sessions and anonymize PII on agreed schedule. Preserve referential and redacted audit history. | Agree retention and deletion SLA before production demo. |
| DEC-15 | §§8–9, 13 · proposed | Core authorizes public AI requests and exchanges identity with isolated FastAPI. Deliver progressive HLS segments via signed private CDN access. | Routing refinement to §9.2. Verify core functions during AI outages. |

## Official compatibility notes

Checked 4 November 2026. Node 24 is LTS and meets the Vite Node floor. Express 5 requires Node 18 or higher. React 18 remains the approved baseline and has archived major-version docs. Confirm and pin patched releases and React 18 peer dependencies for the Vite plugin, router and query client during scaffold. [Node releases](https://nodejs.org/en/about/previous-releases) · [Vite requirements](https://vite.dev/guide/) · [Express installation](https://expressjs.com/en/starter/installing/) · [React versions](https://react.dev/versions).

Use Python 3.12 and lock the FastAPI/Pydantic/Starlette/ASGI tuple. Select PostgreSQL 17 latest patch, pgvector 0.8+ and BullMQ 5 with a compatible managed Redis and noeviction queue setting. Check the extension inventory and run local and staging smoke tests on the pinned tuple. [FastAPI](https://fastapi.tiangolo.com/) · [PostgreSQL support](https://www.postgresql.org/support/versioning/) · [pgvector](https://github.com/pgvector/pgvector) · [BullMQ connections](https://docs.bullmq.io/guide/connections).

Claude Sonnet 5.5 is the candidate. Confirm its API ID and project entitlement at setup, then pin the evaluated model. Anthropic directs embeddings workloads to separate providers. OpenAI text-embedding-3-small defaults to 1536 dimensions. The OpenAI transcription guide documents timestamp granularities for whisper-1 and a 25 MB limit. Provider quotas, latency and retention settings remain setup checks. [Claude models](https://platform.claude.com/docs/en/models/overview) · [Anthropic embeddings guidance](https://platform.claude.com/docs/en/build-with-claude/embeddings) · [OpenAI embedding dimensions](https://developers.openai.com/api/docs/guides/embeddings) · [Speech timestamps and limits](https://developers.openai.com/api/docs/guides/speech-to-text).

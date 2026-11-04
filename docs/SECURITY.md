# Security and permissions

## PRD §11 permission matrix

Roles are additive when explicitly assigned. Route guards check an active role, and service policies resolve the actual resource, current actor and ownership/enrollment. UI hiding is supplementary. For inaccessible private identifiers use consistent 404 concealment or 403 for visible resources with forbidden actions.

| Capability | Student | Instructor | Admin |
|---|---|---|---|
| Register/login | Yes | Yes | Yes |
| Browse approved catalog | Yes | Yes | Yes |
| Enroll | Self | — | — |
| Watch lecture and track progress | Enrolled | — | — |
| Notes and bookmarks | Enrolled and self | — | — |
| Submit assignment or attempt quiz | Enrolled and self | — | — |
| Tutor chat | Enrolled and own session | Reviewer of own course | — |
| Course create/edit | — | Own | Any |
| Upload materials | — | Own | Any |
| Create/approve AI quizzes | — | Own | Any |
| Grade assignments | — | Own | Any |
| Course analytics | — | Own | Any |
| Platform analytics | — | — | Yes |
| Approve/reject submitted course | — | — | Yes |
| Manage roles and suspend/delete accounts | — | — | Yes |
| Moderate forum | — | Own course threads | Platform-wide |
| Revenue/subscriptions governance | — | — | Demo reporting; billing deferred |

Self-registration provisions student only. Instructor/admin provisioning and role elevation are administrative. Validate role changes with a versioned write, and protect the final active admin. Student access also checks active enrollment and course visibility. Community members can read and post within course scope. Announcements require ownership or admin authority. Admin reviewer and instructor views use authoring metadata and scoped material review, with learner routes remaining student-only.

## Identity and data handling

Use Argon2id with benchmarked parameters and per-password salt. Compare generic login failures and normalize email for throttling. Sign short-lived access JWTs (proposed 10 min) and rotating refresh JWTs (proposed 14 days) with distinct audiences and keys. Persist hashed refresh identifiers/family state. In one transaction consume a token and issue its successor. Replay revokes the family, including associated access via session status. Logout revokes the family. Suspension, deletion, role changes and password changes revoke affected sessions immediately. Check active account and session on protected requests. Keep SPA tokens in memory for v1 with single-flight refresh and sign-in after a full reload when tokens are lost. The persisted enrollment remains available after reauthentication. Evaluate cookie/BFF persistence separately with CSRF controls.

Encrypt database, snapshots and object storage with managed keys, plus envelope-encrypt student names/emails where stored as structured PII and use keyed email lookup. Encrypt transport at every hop. Signed playback grants scope to versioned course/lecture paths and expire within five minutes. Private submission, resource and certificate downloads are short-lived and authorized at issuance. File storage uses generated keys, no public bucket policies and download content disposition for potentially active files. Uploads enforce allowlists, size and media signature checks, malware scan and sandboxed parsers. Prevent ZIP traversal and expansion abuse.

Write audit events for PII access, admin actions, approval, review and moderation, recording actor, action, object, time, outcome and correlation ID without secrets. Restrict audit access. Propose 90 days of operational access logs and one year of governance audit history pending retention agreement. Delete identifying data under approved retention, keeping redacted referential history. Exclude passwords, tokens, signed URLs, raw file content and private chat from logs.

## Threat checks

| Scenario | Control and planned test |
|---|---|
| Stolen or replayed tokens | Verify signature/issuer/audience/type, expiry, revocation, replay and rotation races. |
| IDOR or self-approval | Cross-course, cross-learner and role confusion tests for reads, mutations and signed assets. |
| Credential stuffing and AI abuse | Distributed per-IP and account/user limits. Verify trusted proxy IP and Retry-After. Fail closed on unavailable sensitive limiter. |
| Injection and browser execution | Parameterized SQL, strict schemas, escaped output, CSP, allowlisted origins, sanitized links and upload sandboxing. |
| Prompt injection and data exfiltration | Filter before retrieval, no model tools, exclude keys, validate citations, deny on invalid evidence. |
| Credential leakage | Separate stage/prod credentials and IAM roles, short-lived CI OIDC, log redaction, rotate keys and check repository for secrets. |

See [API rates](API_SPECIFICATION.md#errors-and-throttling), [AI safeguards](AI_TUTOR.md), and [recovery](DEPLOYMENT_AND_OPERATIONS.md).

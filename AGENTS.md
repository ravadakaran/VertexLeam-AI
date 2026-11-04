# Workspace guidance

The approved [Word PRD](Document/Project%20Document.docx) governs v1 scope, IDs and priorities. Current user instructions govern the requested work. Use [Decisions](docs/DECISIONS.md) for proposed interpretations. Escalate unresolved policy before implementing affected behavior and keep the original PRD intact.

This handoff is documentation-only. Start application work when requested. Preserve the four-week solo roadmap, full P1/P2 scope and deferred enhancement boundary. Consult [traceability](docs/TRACEABILITY_MATRIX.md) before edits. Update requirement, task, API, planned test and evidence links when behavior changes.

Use PostgreSQL for durable state. Enforce roles at routes and ownership, enrollment and visibility at services. Test features as they land, including access denial and idempotency. Keep secrets in ignored local configuration or the environment secrets manager. Use synthetic fixtures and approved provider data only. Treat deployment status and evidence as planned until observed.

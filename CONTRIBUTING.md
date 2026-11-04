# Contributing

Use the [roadmap](docs/IMPLEMENTATION_PLAN.md) and [backlog](docs/TASKS.md) to pick the smallest dependency-ready slice. Keep the last working demo runnable. Once the repository exists, use a short-lived branch and record task and requirement IDs in the change description. Inspect the diff and merge after checks pass.

- Follow the [folder mapping](docs/ARCHITECTURE.md#folder-mapping). Keep route handlers thin and place policy and transactions at service boundaries.
- Add tests alongside behavior. Cover normal, denial, retry and failure paths as applicable. Update schema, contract and evidence links together.
- Use repeatable synthetic fixtures and keep real learner data, credentials and signed URLs out of source and logs.
- Review migrations on empty and prior databases, API shapes against the contract, and UI paths by role and keyboard. Check ownership and enrollment explicitly.
- Capture command, revision, environment and result. Record pending decisions and unverified checks. See [release gates](docs/DEPLOYMENT_AND_OPERATIONS.md#release-path).

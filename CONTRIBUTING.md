# Contributing

## Get started

Install Node 24, Docker Compose v2 and Python 3.12. Follow [environment setup](docs/ENVIRONMENT_SETUP.md) to configure local services and run the application. The Windows `start.bat` launcher starts the local stack; on macOS/Linux, follow the manual commands in the setup guide.

## Choose and implement work

Use the [roadmap](docs/IMPLEMENTATION_PLAN.md) and [backlog](docs/TASKS.md) to pick the smallest dependency-ready slice. Preserve the approved four-week solo roadmap, full P1/P2 scope and deferred enhancement boundary. Consult [traceability](docs/TRACEABILITY_MATRIX.md) before changing behavior. Keep the last working demo runnable. Use a short-lived branch and record task and requirement IDs in the change description.

- Follow the [folder mapping](docs/ARCHITECTURE.md#folder-mapping). Keep route handlers thin and place policy and transactions at service boundaries.
- Add tests alongside behavior. Cover normal, denial, retry and failure paths as applicable. Update schema, contract and evidence links together.
- Use repeatable synthetic fixtures and keep real learner data, credentials and signed URLs out of source and logs.
- Review migrations on empty and prior databases, API shapes against the contract, and UI paths by role and keyboard. Check ownership and enrollment explicitly.
- Capture command, revision, environment and result. Record pending decisions and unverified checks. See [release gates](docs/DEPLOYMENT_AND_OPERATIONS.md#release-path).

## Verify and open a pull request

Run the checks relevant to your change before opening a pull request:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
python -m unittest discover -s ai-service/tests -t ai-service -v
```

In the pull request, describe the change, link its task and requirement IDs, list the commands and outcomes, and include screenshots for UI changes. Call out migrations, security implications, policy decisions, and checks that could not be run. Inspect the final diff and wait for CI before merging.

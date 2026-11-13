# VertexLearn AI

An online learning platform for students and instructors that brings courses, assessments, and course-grounded AI tutoring into one workspace.

[![CI](https://github.com/ravadakaran/VertexLeam-AI/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ravadakaran/VertexLeam-AI/actions/workflows/ci.yml)

**Start locally (Windows):** install Node 24 and Docker Desktop, clone this repository, then run `start.bat` from the project folder. It starts the local database and cache, applies migrations, seeds synthetic demo data, and opens the app. Review `.env.example` and the [environment setup guide](docs/ENVIRONMENT_SETUP.md) before using it. macOS/Linux setup is documented in the same guide.

> A recorded demo and hosted playground are not available yet. Deployment and demo evidence remain planned.

VertexLearn AI follows the [approved v1.0 Word PRD](Document/Project%20Document.docx). The local application includes role workspaces, course authoring and enrollment, private HLS playback, learning progress, assignments and quizzes. Deployment remains planned.

The four-week scope covers student learning and assessment, an instructor workspace, admin governance, course-grounded AI tutoring, and supporting discussions and notifications. The first slice is sign-in → instructor creates a course → authorized approval → catalog → student enrollment and persisted dashboard.

## Selected stack

React 18, TypeScript, Vite, Zustand, TanStack Query and Tailwind for the SPA. Node 24 LTS, Express and TypeScript for core LMS. Python/FastAPI for AI. PostgreSQL 17 and pgvector, Redis and BullMQ, and S3-compatible storage with MinIO locally. Anthropic handles generation, with OpenAI embeddings and managed Whisper transcription. NGINX and Compose support local development. ECS and managed AWS data services are the proposed cloud deployment.

## Setup and verification paths

Use Node 24 and Docker Compose v2 to [run the foundation locally](docs/ENVIRONMENT_SETUP.md#run-the-foundation). The [test register](docs/TESTING_STRATEGY.md#test-register) defines acceptance checks. See the [demo runbook](docs/DEMO_AND_SUBMISSION.md) for the full walkthrough and [agent guidance](AGENTS.md) for implementation workflow.

## Documentation index

- [Project requirements](docs/PROJECT_REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [Api specification](docs/API_SPECIFICATION.md)
- [Ai tutor](docs/AI_TUTOR.md)
- [Assessments and grading](docs/ASSESSMENTS_AND_GRADING.md)
- [Personalization and analytics](docs/PERSONALIZATION_AND_ANALYTICS.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Tasks](docs/TASKS.md)
- [Security](docs/SECURITY.md)
- [Environment setup](docs/ENVIRONMENT_SETUP.md)
- [Deployment and operations](docs/DEPLOYMENT_AND_OPERATIONS.md)
- [Testing strategy](docs/TESTING_STRATEGY.md)
- [Decisions](docs/DECISIONS.md)
- [Traceability matrix](docs/TRACEABILITY_MATRIX.md)
- [Demo and submission](docs/DEMO_AND_SUBMISSION.md)
- [Changelog](CHANGELOG.md)
- [GitHub social preview artwork](docs/assets/social-preview.jpg)
- [OpenAPI 3.0 contract](docs/api-spec.yaml)

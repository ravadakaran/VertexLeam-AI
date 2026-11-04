# Environment setup

The local application covers [TASK-001 through TASK-010](TASKS.md#task-001). The full-stack setup below follows §13/§16 of the [approved Word PRD](../Document/Project%20Document.docx).

## Run the foundation

1. Install Node 24, npm and Docker Compose v2. Copy [`.env.example`](../.env.example) to `.env`.
2. Generate a unique local `POSTGRES_PASSWORD` and set `DATABASE_URL` to `postgresql://vertexlearn:<password>@127.0.0.1:15432/vertexlearn`. URL-encode the password component. Generate distinct random `ACCESS_JWT_KEY` and `REFRESH_JWT_KEY` values of at least 32 bytes. Choose a synthetic `DEMO_PASSWORD` of 12 to 128 characters.
3. Run the commands below from the project root. Keep the API and web commands running in separate terminals.

```sh
npm ci
docker compose --env-file .env -f infra/docker-compose.yml up -d --wait
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:web
```

Open [the sign-in screen](http://127.0.0.1:5173/login) and use `student@vertexlearn.test`, `instructor@vertexlearn.test`, or `admin@vertexlearn.test` with your configured demo password. Seeds are insert-only and preserve an existing account's credentials. API readiness is at `GET http://127.0.0.1:3000/health/ready`.

With the API and web terminals stopped, run `npm test`, `npm run typecheck`, `npm run build`, `npx playwright install chromium`, and `npm run test:e2e`. Browser tests launch both dev servers. If repeated browser runs hit the auth rate limit, retry after the `Retry-After` window.

## Run the learning walkthrough

1. Sign in as the demo instructor, create a course, and open it from **My courses**. Add a module and upload an MP4, MOV, or WebM video up to 24 MiB and five minutes. A lecture can also include English WebVTT captions and up to four PDF or PPTX resources.
2. Copy the course ID from the workspace URL. From the project root run `npm run demo:approve -- <course-id>`. The fixture uses the seeded admin and records the review in PostgreSQL.
3. Sign in as the demo student, find the course in **Course catalog**, enroll, then open it from **My learning**. Playback speed, resume, notes, and bookmarks are available from the lecture. Assignments and published quizzes appear in the course.

For synthetic uploads on a disposable local environment, set `SYNTHETIC_UPLOADS=true` in ignored configuration. For scanner-backed uploads, set `UPLOAD_SCANNER` to an executable that accepts the quarantined path and returns 0 for clean, 1 for infected, and another code for scan failure. Use maintained scanner signatures and configure scanning limits to cover the allowed upload sizes. Configure `FFMPEG_PATH` and `FFPROBE_PATH` to maintained executables outside development or test. `PUBLIC_APP_ORIGIN` determines the origin used for signed links. [ClamAV scanning documentation](https://docs.clamav.net/manual/Usage/Scanning.html)

The local implementation packages HLS before committing the lecture and stores private bytes in PostgreSQL. A separate packaging worker, object storage and CDN are deployment work.

## Toolchain

- Node 24 LTS and npm, Python 3.12 and pip, Git and GitHub, Docker Desktop or Docker Engine with Compose v2. Pin runtimes and package lockfiles in CI. See [compatibility sources](DECISIONS.md#official-compatibility-notes).
- PostgreSQL 17 with pgvector 0.8+, Redis, MinIO and an email sandbox in Compose. Use psql/DBeaver and redis-cli/RedisInsight for inspection. Include FFmpeg/ffprobe in the media worker.
- VS Code with ESLint, Prettier, Python and Docker integration. Use Postman or Insomnia with test identities. Jest/Supertest, Pytest, Playwright and k6 cover application checks.
- Use Figma or equivalent for role workspace flows and Mermaid for versioned diagrams. Use GitHub and docs for handoff. Prometheus-compatible metrics, Grafana or cloud dashboards, centralized logs and an external uptime probe support operations.

## Prospective local path

1. Confirm `node --version`, `python --version`, `docker compose version`, and `git --version`.
2. Copy `.env.example` to a local ignored environment file. Run `docker compose --env-file .env -f infra/docker-compose.yml config --quiet`.
3. Start the future stack with `docker compose --env-file .env -f infra/docker-compose.yml up --build -d`. Include PostgreSQL/vector, cache/queue Redis, MinIO, core, frontend, FastAPI and Node workers. Route via local NGINX. Keep production-like private service paths.
4. Run the future migration and demo seed commands using the core container, with environment guards for synthetic data. Check service readiness and use the [demo sequence](DEMO_AND_SUBMISSION.md). Run the future npm and pytest checks in CI and locally with isolated test schemas.

| Configuration | Purpose |
|---|---|
| DATABASE_URL, AI_DATABASE_URL | Separate least-privileged credentials and TLS options |
| REDIS_CACHE_URL, REDIS_QUEUE_URL | Evictable cache and durable noeviction job instance |
| JWT signing/verification keys, SERVICE_JWT keys | Distinct key sets and rotation IDs |
| S3 endpoint, region, bucket and credentials | Local MinIO or cloud role; separate asset prefixes |
| CDN signing keys, app origin, email sender | Private grants, CORS and sandbox delivery |
| ANTHROPIC_API_KEY, ANTHROPIC_MODEL | Private generation service only |
| OPENAI_API_KEY, embedding and STT model IDs | Separate provider budget for vectors and timestamps |
| OTEL exporter, environment and release SHA | Correlated logs, metrics and traces |

Use fixture adapters without provider secrets for automated checks. Enable real provider calls only for explicit evaluation. Keep credentials out of frontend build variables, docs and checked-in examples. Required accounts and release setup are in [operations](DEPLOYMENT_AND_OPERATIONS.md).

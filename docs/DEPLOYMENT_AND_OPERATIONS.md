# Deployment and operations

## Environment and accounts

Local runs PostgreSQL/vector, Redis, MinIO, frontend, backend, AI and workers under Compose. Staging and production use separate credentials, data, buckets and configuration with smaller staging resources. Proposed cloud footprint uses ECS Fargate, private service networking, ALB TLS, RDS PostgreSQL with PITR, managed Redis for cache and jobs, S3 and CloudFront, SES, Secrets Manager/KMS and CloudWatch. Use managed TLS certificates and separate CDN origins. Restrict S3 access to the CDN/worker roles, set object lifecycle rules for abandoned uploads and approved retention, and configure SES sandbox/test recipients on staging.

Before staging, obtain GitHub, cloud and image registry accounts, DNS/domain and TLS authorization, email sending identity, Anthropic and OpenAI API access and provider budget. Confirm managed PostgreSQL extension support, cloud quota, DNS validation, monitoring and external uptime probe ownership. Infrastructure remains planned.

## Release path

| Trigger | Gate |
|---|---|
| Pull request | Lint, type-check, Jest/Supertest, Pytest, contract checks, Playwright smoke, build frontend/backend/AI and scan images/dependencies. |
| Merge to main | Build immutable images, tag commit SHA, push registry, run one additive migration job, deploy to staging and run smoke tests against recorded digests. |
| Tagged release | Promote staging digests with environment approval and rolling health gates. Record config revision, migration version and production smoke results. |
| Regression | Stop promotion or redeploy prior known-good digests and compatible configuration, then repeat smoke. Restore data separately if corruption occurred. |

Use GitHub Actions OIDC to obtain deployment credentials. Require reviewable migration and release logs. Additive expand/backfill/contract steps keep older images compatible. Destructive cleanup waits until the rollback window ends. Where rollback cannot safely read a migrated schema, prefer a corrective migration after recovery assessment.

## Health, scaling and recovery

Per service expose liveness for process health and readiness for required dependencies. Core readiness checks PostgreSQL and its own config independently of AI. Export latency, status, saturation, DB pool wait, queue age/retries, cache hit rate and provider latency/error rate. Structured Winston/structlog events carry release ID and request/trace ID. Centralize logs with alerts for core availability, p95 regressions, queue lag and budget spikes. Synthetic checks exercise auth, catalog and a protected read from outside the cloud.

Scale stateless core and AI independently, cap pools and worker concurrency, and isolate AI and background work from core request capacity. Offload media to CDN. Add a reporting replica only when measured reporting contention affects OLTP, and expose its freshness. See [cache and job rules](ARCHITECTURE.md).

Enable database automated backups and PITR, object versioning and encrypted snapshots. Proposed recovery objectives are RPO 15 minutes and RTO 2 hours, pending a measured restore drill. Restore to isolated instances, run migration and consistency checks, reconcile certificates and asset references, rebuild Redis cache and replay durable outbox/jobs. Verify one enrollment, a grade, a citation and a file grant before switching traffic. Record restore timestamps, achieved RPO/RTO and unresolved gaps. Track the 99.5% core target over a rolling 30-day window with AI excluded. See [evidence](TESTING_STRATEGY.md).

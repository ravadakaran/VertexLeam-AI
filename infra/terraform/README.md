# Planned Terraform IaC (DEC-13)

Status: **Planned** (`TASK-023`). Not initialized or applied in this repository environment.

## Topology Summary
- **Edge & Compute**: Application Load Balancer (`aws_lb.edge`) routing `/api/*` and `/health/*` to ECS Fargate `backend` (`3000`) alongside `frontend` (`8080`), an internal-only `ai-service` task definition, and a standalone ECS Fargate `worker` running `node backend/src/jobs/worker.ts` (`WORKER_MODE=external`).
- **Managed Data**: Private-subnet PostgreSQL 17 RDS instance (`aws_db_instance.postgres`, multi-AZ in `production`) and ElastiCache Redis (`aws_elasticache_replication_group.redis`) with transit and rest encryption.
- **Storage & Governance**: Private-only S3 bucket (`aws_s3_bucket_public_access_block.media`), CloudWatch log group (`/ecs/vertexlearn-<env>`), and AWS Secrets Manager container injection (`aws_secretsmanager_secret.runtime`).

## Planned Verification Commands (when Terraform CLI + AWS OIDC are provisioned)
```sh
cd infra/terraform
terraform fmt -check
terraform init -backend=false
terraform validate
```


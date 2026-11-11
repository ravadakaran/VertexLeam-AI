output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "alb_dns_name" {
  value = aws_lb.edge.dns_name
}

output "private_media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "postgres_endpoint" {
  value = aws_db_instance.postgres.endpoint
}

output "redis_primary_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}


variable "aws_region" {
  type        = string
  description = "Target AWS region for ECS Fargate and managed backing services"
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment name (staging or production)"
  default     = "staging"
}

variable "vpc_id" {
  type        = string
  description = "Existing VPC identifier"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnets for ECS tasks, RDS PostgreSQL, and ElastiCache Redis"
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnets for the Application Load Balancer"
}

variable "backend_image" {
  type        = string
  description = "Digest-pinned container image URI for the backend API and notification worker"
}

variable "frontend_image" {
  type        = string
  description = "Digest-pinned container image URI for the frontend SPA"
}

variable "ai_service_image" {
  type        = string
  description = "Digest-pinned container image URI for the internal FastAPI AI service"
}

variable "release_id" {
  type        = string
  description = "Immutable release identifier (git SHA or tag)"
}


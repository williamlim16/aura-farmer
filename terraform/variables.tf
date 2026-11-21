variable "project_name" {
  description = "Project identifier used to prefix AWS resource names."
  type        = string
  default     = "aura-farmer"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "project_name must contain only lowercase alphanumeric characters and hyphens."
  }
}

variable "environment" {
  description = "Deployment environment name (e.g., dev, staging, prod)."
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "aws_region" {
  description = "AWS region where Textract and the resume S3 bucket reside. Must be a region supporting Amazon Textract."
  type        = string
  default     = "ap-southeast-2"

  validation {
    condition = contains([
      "us-east-1",
      "us-east-2",
      "us-west-1",
      "us-west-2",
      "ca-central-1",
      "eu-west-1",
      "eu-west-2",
      "eu-west-3",
      "eu-central-1",
      "eu-south-1",
      "ap-south-1",
      "ap-northeast-2",
      "ap-southeast-1",
      "ap-southeast-2",
    ], var.aws_region)
    error_message = "aws_region must be an AWS region that supports Amazon Textract (e.g., ap-southeast-2, ap-southeast-1, us-east-1, us-west-2, eu-west-1)."
  }
}

variable "resume_bucket_name" {
  description = "Optional custom S3 bucket name for uploaded resumes. If null, defaults to '<project_name>-<environment>-resumes-<account_id>'."
  type        = string
  default     = null
}

variable "force_destroy_bucket" {
  description = "Allow Terraform to destroy the resume S3 bucket even when it contains objects (recommended only for dev/test)."
  type        = bool
  default     = false
}

variable "enable_bucket_versioning" {
  description = "Enable S3 object versioning on the resume upload bucket."
  type        = bool
  default     = false
}

variable "resume_retention_days" {
  description = "Number of days to retain uploaded resume files and temporary Textract outputs before automatic S3 lifecycle expiration. Set to 0 to disable expiration."
  type        = number
  default     = 7

  validation {
    condition     = var.resume_retention_days >= 0 && floor(var.resume_retention_days) == var.resume_retention_days
    error_message = "resume_retention_days must be a non-negative integer."
  }
}

variable "cors_allowed_origins" {
  description = "Allowed CORS origins for direct browser-to-S3 presigned URL resume uploads."
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "create_app_iam_user" {
  description = "Create a dedicated IAM user with least-privilege permissions for the application to call Textract and access the resume S3 bucket."
  type        = bool
  default     = true
}

variable "create_app_access_key" {
  description = "Generate an IAM access key pair for the application IAM user (output as sensitive values for your .env configuration)."
  type        = bool
  default     = true
}

variable "enable_async_notifications" {
  description = "Provision an SNS topic, SQS queue (+ DLQ), and Textract IAM service role for asynchronous multi-page PDF resume processing notifications."
  type        = bool
  default     = true
}

variable "sqs_message_retention_seconds" {
  description = "Retention period (in seconds) for Textract completion messages in the SQS queue."
  type        = number
  default     = 86400 # 1 day
}

variable "tags" {
  description = "Additional tags to apply to all created AWS resources."
  type        = map(string)
  default     = {}
}

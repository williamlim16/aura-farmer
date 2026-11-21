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
  description = "AWS region for Amazon Textract. Must be a region supporting Amazon Textract."
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

variable "aws_access_key_id" {
  description = "Optional AWS Access Key ID used by Terraform to provision resources. If null, Terraform falls back to AWS_ACCESS_KEY_ID env var or ~/.aws/credentials."
  type        = string
  default     = null
  sensitive   = true
}

variable "aws_secret_access_key" {
  description = "Optional AWS Secret Access Key used by Terraform to provision resources. If null, Terraform falls back to AWS_SECRET_ACCESS_KEY env var or ~/.aws/credentials."
  type        = string
  default     = null
  sensitive   = true
}

variable "aws_session_token" {
  description = "Optional AWS Session Token (only required when using temporary STS/SSO credentials)."
  type        = string
  default     = null
  sensitive   = true
}

variable "aws_profile" {
  description = "Optional AWS CLI profile name from ~/.aws/credentials or ~/.aws/config."
  type        = string
  default     = null
}

variable "create_app_iam_user" {
  description = "Create a dedicated IAM user with least-privilege permissions for the application to call Amazon Textract."
  type        = bool
  default     = true
}

variable "create_app_access_key" {
  description = "Generate an IAM access key pair for the application IAM user (output as sensitive values for your .env configuration)."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional tags to apply to all created AWS resources."
  type        = map(string)
  default     = {}
}

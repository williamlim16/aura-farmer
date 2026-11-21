output "aws_region" {
  description = "AWS region configured for Amazon Textract."
  value       = var.aws_region
}

output "app_iam_policy_arn" {
  description = "ARN of the least-privilege IAM policy for Amazon Textract (attachable to any IAM role or user)."
  value       = aws_iam_policy.app_textract.arn
}

output "app_iam_user_name" {
  description = "IAM user name created for the application."
  value       = var.create_app_iam_user ? aws_iam_user.app[0].name : null
}

output "app_aws_access_key_id" {
  description = "AWS Access Key ID for the application IAM user."
  value       = var.create_app_iam_user && var.create_app_access_key ? aws_iam_access_key.app[0].id : null
}

output "app_aws_secret_access_key" {
  description = "AWS Secret Access Key for the application IAM user."
  value       = var.create_app_iam_user && var.create_app_access_key ? aws_iam_access_key.app[0].secret : null
  sensitive   = true
}

output "dotenv_snippet" {
  description = "Ready-to-paste .env configuration block for the Next.js application (run `terraform output -raw dotenv_snippet`)."
  sensitive   = true
  value       = <<-EOT
    # AWS Textract
    AWS_REGION="${var.aws_region}"
    AWS_ACCESS_KEY_ID="${var.create_app_iam_user && var.create_app_access_key ? aws_iam_access_key.app[0].id : ""}"
    AWS_SECRET_ACCESS_KEY="${var.create_app_iam_user && var.create_app_access_key ? aws_iam_access_key.app[0].secret : ""}"
  EOT
}

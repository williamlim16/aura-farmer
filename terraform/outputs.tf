output "aws_region" {
  description = "AWS region configured for Textract and S3."
  value       = var.aws_region
}

output "resume_s3_bucket_name" {
  description = "Name of the S3 bucket storing uploaded resumes for Textract."
  value       = aws_s3_bucket.resumes.id
}

output "resume_s3_bucket_arn" {
  description = "ARN of the S3 bucket storing uploaded resumes."
  value       = aws_s3_bucket.resumes.arn
}

output "app_iam_policy_arn" {
  description = "ARN of the least-privilege IAM policy for Textract and resume S3 access (attachable to any IAM role or user)."
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

output "textract_sns_topic_arn" {
  description = "SNS Topic ARN notified when asynchronous multi-page PDF Textract jobs finish."
  value       = var.enable_async_notifications ? aws_sns_topic.textract_completion[0].arn : null
}

output "textract_service_role_arn" {
  description = "IAM Role ARN passed in NotificationChannel.RoleArn when calling StartDocumentTextDetection / StartDocumentAnalysis."
  value       = var.enable_async_notifications ? aws_iam_role.textract_service_role[0].arn : null
}

output "textract_sqs_queue_url" {
  description = "SQS Queue URL receiving Textract asynchronous job completion messages."
  value       = var.enable_async_notifications ? aws_sqs_queue.textract_jobs[0].url : null
}

output "textract_sqs_dlq_url" {
  description = "Dead-letter SQS Queue URL for failed Textract notification messages."
  value       = var.enable_async_notifications ? aws_sqs_queue.textract_dlq[0].url : null
}

output "dotenv_snippet" {
  description = "Ready-to-paste .env configuration block for the Next.js application (run `terraform output -raw dotenv_snippet`)."
  sensitive   = true
  value       = <<-EOT
    # AWS Textract & Resume S3 Storage
    AWS_REGION="${var.aws_region}"
    AWS_ACCESS_KEY_ID="${var.create_app_iam_user && var.create_app_access_key ? aws_iam_access_key.app[0].id : ""}"
    AWS_SECRET_ACCESS_KEY="${var.create_app_iam_user && var.create_app_access_key ? aws_iam_access_key.app[0].secret : ""}"
    AWS_TEXTRACT_S3_BUCKET="${aws_s3_bucket.resumes.id}"
    AWS_TEXTRACT_SNS_TOPIC_ARN="${var.enable_async_notifications ? aws_sns_topic.textract_completion[0].arn : ""}"
    AWS_TEXTRACT_ROLE_ARN="${var.enable_async_notifications ? aws_iam_role.textract_service_role[0].arn : ""}"
    AWS_TEXTRACT_SQS_QUEUE_URL="${var.enable_async_notifications ? aws_sqs_queue.textract_jobs[0].url : ""}"
  EOT
}

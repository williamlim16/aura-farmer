# ------------------------------------------------------------------------------
# Asynchronous Textract Notification Pipeline (Multi-page PDF Resumes)
# Flow: Textract Async Job -> IAM Service Role -> SNS Topic -> SQS Queue (+ DLQ)
# ------------------------------------------------------------------------------

resource "aws_sns_topic" "textract_completion" {
  count = var.enable_async_notifications ? 1 : 0
  name  = "AmazonTextract-${local.name_prefix}-resume-jobs"
}

resource "aws_sqs_queue" "textract_dlq" {
  count                     = var.enable_async_notifications ? 1 : 0
  name                      = "${local.name_prefix}-textract-resume-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "textract_jobs" {
  count                      = var.enable_async_notifications ? 1 : 0
  name                       = "${local.name_prefix}-textract-resume-jobs"
  visibility_timeout_seconds = 120
  message_retention_seconds  = var.sqs_message_retention_seconds
  receive_wait_time_seconds  = 20 # Enable long polling
  sqs_managed_sse_enabled    = true
}

resource "aws_sqs_queue_redrive_policy" "textract_jobs" {
  count     = var.enable_async_notifications ? 1 : 0
  queue_url = aws_sqs_queue.textract_jobs[0].id

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.textract_dlq[0].arn
    maxReceiveCount     = 5
  })
}

data "aws_iam_policy_document" "textract_sqs_policy" {
  count = var.enable_async_notifications ? 1 : 0

  statement {
    sid    = "AllowSNSTopicPublish"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.textract_jobs[0].arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_sns_topic.textract_completion[0].arn]
    }
  }
}

resource "aws_sqs_queue_policy" "textract_jobs" {
  count     = var.enable_async_notifications ? 1 : 0
  queue_url = aws_sqs_queue.textract_jobs[0].id
  policy    = data.aws_iam_policy_document.textract_sqs_policy[0].json
}

resource "aws_sns_topic_subscription" "textract_to_sqs" {
  count     = var.enable_async_notifications ? 1 : 0
  topic_arn = aws_sns_topic.textract_completion[0].arn
  protocol  = "sqs"
  endpoint  = aws_sqs_queue.textract_jobs[0].arn
}

# IAM Role assumed by Amazon Textract to publish job status to SNS
data "aws_iam_policy_document" "textract_service_assume_role" {
  count = var.enable_async_notifications ? 1 : 0

  statement {
    sid     = "AllowTextractAssumeRole"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["textract.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "textract_service_role" {
  count              = var.enable_async_notifications ? 1 : 0
  name               = "${local.name_prefix}-textract-sns-role"
  description        = "Allows Amazon Textract to publish asynchronous resume extraction job completion notifications to SNS."
  assume_role_policy = data.aws_iam_policy_document.textract_service_assume_role[0].json
}

data "aws_iam_policy_document" "textract_service_sns_publish" {
  count = var.enable_async_notifications ? 1 : 0

  statement {
    sid       = "AllowPublishToTextractSNSTopic"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.textract_completion[0].arn]
  }
}

resource "aws_iam_role_policy" "textract_service_sns_publish" {
  count  = var.enable_async_notifications ? 1 : 0
  name   = "${local.name_prefix}-textract-sns-publish"
  role   = aws_iam_role.textract_service_role[0].id
  policy = data.aws_iam_policy_document.textract_service_sns_publish[0].json
}

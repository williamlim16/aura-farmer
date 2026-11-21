# ------------------------------------------------------------------------------
# Application IAM Policy & Credentials for Resume Extraction via AWS Textract
# ------------------------------------------------------------------------------

data "aws_iam_policy_document" "app_textract" {
  statement {
    sid    = "TextractResumeExtraction"
    effect = "Allow"

    actions = [
      "textract:DetectDocumentText",
      "textract:AnalyzeDocument",
      "textract:StartDocumentTextDetection",
      "textract:GetDocumentTextDetection",
      "textract:StartDocumentAnalysis",
      "textract:GetDocumentAnalysis",
    ]

    # Amazon Textract document analysis operations do not support resource-level ARNs
    resources = ["*"]
  }

  statement {
    sid    = "ResumeBucketList"
    effect = "Allow"

    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]

    resources = [aws_s3_bucket.resumes.arn]
  }

  statement {
    sid    = "ResumeBucketObjectAccess"
    effect = "Allow"

    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]

    resources = ["${aws_s3_bucket.resumes.arn}/*"]
  }

  dynamic "statement" {
    for_each = var.enable_async_notifications ? [1] : []

    content {
      sid       = "PassTextractServiceRole"
      effect    = "Allow"
      actions   = ["iam:PassRole"]
      resources = [aws_iam_role.textract_service_role[0].arn]

      condition {
        test     = "StringEquals"
        variable = "iam:PassedToService"
        values   = ["textract.amazonaws.com"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.enable_async_notifications ? [1] : []

    content {
      sid    = "ConsumeTextractJobQueue"
      effect = "Allow"

      actions = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility",
      ]

      resources = [aws_sqs_queue.textract_jobs[0].arn]
    }
  }
}

resource "aws_iam_policy" "app_textract" {
  name        = "${local.name_prefix}-app-textract-policy"
  description = "Least-privilege policy for ${var.project_name} to upload resumes to S3 and extract resume information with AWS Textract."
  policy      = data.aws_iam_policy_document.app_textract.json
}

resource "aws_iam_user" "app" {
  count = var.create_app_iam_user ? 1 : 0
  name  = "${local.name_prefix}-textract-app"
  path  = "/system/"
}

resource "aws_iam_user_policy_attachment" "app_textract" {
  count      = var.create_app_iam_user ? 1 : 0
  user       = aws_iam_user.app[0].name
  policy_arn = aws_iam_policy.app_textract.arn
}

resource "aws_iam_access_key" "app" {
  count = var.create_app_iam_user && var.create_app_access_key ? 1 : 0
  user  = aws_iam_user.app[0].name
}

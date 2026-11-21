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
    sid    = "BedrockResumeStructuring"
    effect = "Allow"

    actions = [
      "bedrock:InvokeModel",
    ]

    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:*:*:inference-profile/*",
    ]
  }
}

resource "aws_iam_policy" "app_textract" {
  name        = "${local.name_prefix}-app-textract-policy"
  description = "Least-privilege policy for ${var.project_name} to extract resume information with AWS Textract."
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

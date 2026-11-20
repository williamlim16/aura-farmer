data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name_prefix        = "${var.project_name}-${var.environment}"
  resume_bucket_name = coalesce(var.resume_bucket_name, "${local.name_prefix}-resumes-${data.aws_caller_identity.current.account_id}")
}

resource "aws_s3_bucket" "resumes" {
  bucket        = local.resume_bucket_name
  force_destroy = var.force_destroy_bucket
}

resource "aws_s3_bucket_ownership_controls" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  versioning_configuration {
    status = var.enable_bucket_versioning ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "resumes" {
  bucket = aws_s3_bucket.resumes.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  rule {
    id     = "expire-temporary-resumes"
    status = var.resume_retention_days > 0 ? "Enabled" : "Disabled"

    filter {}

    expiration {
      days = var.resume_retention_days > 0 ? var.resume_retention_days : 7
    }

    noncurrent_version_expiration {
      noncurrent_days = var.resume_retention_days > 0 ? var.resume_retention_days : 7
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "resumes" {
  count  = length(var.cors_allowed_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.resumes.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD", "PUT", "POST"]
    allowed_origins = var.cors_allowed_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "resumes_bucket_policy" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]

    resources = [
      aws_s3_bucket.resumes.arn,
      "${aws_s3_bucket.resumes.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "AllowTextractServiceAccess"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["textract.amazonaws.com"]
    }

    actions = [
      "s3:GetObject",
      "s3:ListBucket",
    ]

    resources = [
      aws_s3_bucket.resumes.arn,
      "${aws_s3_bucket.resumes.arn}/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_s3_bucket_policy" "resumes" {
  bucket     = aws_s3_bucket.resumes.id
  policy     = data.aws_iam_policy_document.resumes_bucket_policy.json
  depends_on = [aws_s3_bucket_public_access_block.resumes]
}

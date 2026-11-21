# AWS Textract Resume Extraction — Terraform Infrastructure

This Terraform stack provisions the AWS infrastructure required for **Aura Farmer** to accept uploaded resumes (single-page or multi-page PDFs, PNG, JPEG) and extract structured candidate details using **Amazon Textract**.

## What This Provisions

1. **Resume Upload S3 Bucket (`s3.tf`)**
   - Private S3 bucket (`<project_name>-<environment>-resumes-<account_id>`) with all public access blocked (`BucketOwnerEnforced`).
   - Server-side encryption enabled (`SSE-S3` / `AES256`) and HTTPS-only bucket policy (`aws:SecureTransport`).
   - Bucket policy allowing `textract.amazonaws.com` in your AWS account to read uploaded resume objects.
   - Configurable lifecycle rule (`resume_retention_days = 7` by default) to automatically expire temporary uploaded resumes and abort incomplete multipart uploads.
   - CORS configuration for direct browser-to-S3 presigned URL uploads.

2. **Application IAM Policy, User & Access Keys (`iam.tf`)**
   - Least-privilege IAM policy (`<project_name>-<environment>-app-textract-policy`) granting:
     - Synchronous Textract APIs: `textract:DetectDocumentText`, `textract:AnalyzeDocument`
     - Asynchronous Textract APIs (required for multi-page PDFs): `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`, `textract:StartDocumentAnalysis`, `textract:GetDocumentAnalysis`
     - Scoped S3 read/write/delete on the resume bucket (`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`)
     - Scoped `iam:PassRole` for the Textract notification service role (`iam:PassedToService = textract.amazonaws.com`)
     - Scoped SQS consumption (`sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`, `sqs:ChangeMessageVisibility`)

3. **Asynchronous Multi-Page PDF Notification Pipeline (`notifications.tf`)**
   - Multi-page PDF resumes require Textract's asynchronous APIs (`StartDocumentTextDetection` or `StartDocumentAnalysis`).
   - Provisions:
     - **IAM Service Role** (`<project_name>-<environment>-textract-sns-role`) assumed by `textract.amazonaws.com`
     - **SNS Topic** (`AmazonTextract-<project_name>-<environment>-resume-jobs`)
     - **SQS Queue + Dead-Letter Queue (DLQ)** (`<project_name>-<environment>-textract-resume-jobs`) subscribed to the SNS topic so the application can reliably consume completion notifications or poll `GetDocumentTextDetection` / `GetDocumentAnalysis`.

---

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) `>= 1.5.0`
- AWS CLI authenticated with permissions to manage S3, IAM, SNS, and SQS (`aws configure` or `AWS_PROFILE`)

---

## Usage

```bash
cd terraform

# 1. Copy example variables and customize if needed
cp terraform.tfvars.example terraform.tfvars

# 2. Initialize Terraform providers
terraform init

# 3. Preview planned changes
terraform plan

# 4. Provision resources
terraform apply
```

### Export Environment Variables to `.env`

After `terraform apply` succeeds, print the ready-to-paste `.env` block:

```bash
terraform output -raw dotenv_snippet
```

Append those variables to the root `.env` file of the Next.js application.

---

## Tear Down

```bash
cd terraform
terraform destroy
```

> **Note:** If the S3 bucket still contains uploaded resume objects during development teardown, either empty the bucket first or set `force_destroy_bucket = true` in `terraform.tfvars`.

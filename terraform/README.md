# AWS Textract Resume Extraction — Terraform Infrastructure

This Terraform stack provisions the dedicated least-privilege AWS IAM user, policy, and access keys required for **Aura Farmer** to extract structured candidate details from resumes using **Amazon Textract** (while resume files are stored in **Supabase Storage**).

## What This Provisions

- **Application IAM Policy, User & Access Keys (`iam.tf`)**
  - Least-privilege IAM policy (`<project_name>-<environment>-app-textract-policy`) granting:
    - Synchronous Textract APIs: `textract:DetectDocumentText`, `textract:AnalyzeDocument`
    - Asynchronous Textract APIs: `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`, `textract:StartDocumentAnalysis`, `textract:GetDocumentAnalysis`
    - Amazon Bedrock inference (`bedrock:InvokeModel`) for cost-effective structured resume parsing (defaults to `amazon.nova-micro-v1:0` / `amazon.nova-lite-v1:0`)
  - Dedicated IAM User (`<project_name>-<environment>-textract-app`) and IAM Access Key pair for the Next.js app.

---

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) `>= 1.5.0`
- An AWS account with **`IAMFullAccess`** permission to create the application IAM user, policy, and access key.

---

## Supplying AWS Credentials to Terraform

You can authenticate Terraform with AWS using **any one** of the following methods:

### Option 1: Set directly in `terraform/terraform.tfvars` (Quickest — gitignored)

`terraform.tfvars` is excluded by `.gitignore`. Uncomment and fill in your credentials in `terraform/terraform.tfvars`:

```hcl
aws_access_key_id     = "AKIAxxxxxxxxxxxxxxxx"
aws_secret_access_key = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### Option 2: Export environment variables in your terminal

```bash
export AWS_ACCESS_KEY_ID="AKIAxxxxxxxxxxxxxxxx"
export AWS_SECRET_ACCESS_KEY="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
# Optional if using temporary SSO/STS credentials:
# export AWS_SESSION_TOKEN="..."
```

### Option 3: Shared AWS credentials file (`~/.aws/credentials`)

Create `~/.aws/credentials` (or run `aws configure` if the AWS CLI is installed):

```ini
[default]
aws_access_key_id = AKIAxxxxxxxxxxxxxxxx
aws_secret_access_key = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

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

CREATE TABLE "aura-farmer_job_posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" varchar(16) NOT NULL,
	"source_url" text,
	"external_id" varchar(200),
	"title" varchar(300) NOT NULL,
	"company" varchar(200) NOT NULL,
	"location" varchar(200) DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"requirements" jsonb NOT NULL,
	"retrieval" varchar(16) NOT NULL,
	"match" jsonb,
	"tailoring" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aura-farmer_application" ADD COLUMN "posting_id" uuid;--> statement-breakpoint
CREATE INDEX "job_posting_user_idx" ON "aura-farmer_job_posting" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_posting_user_external_idx" ON "aura-farmer_job_posting" USING btree ("user_id","source","external_id") WHERE external_id is not null;--> statement-breakpoint
ALTER TABLE "aura-farmer_application" ADD CONSTRAINT "aura-farmer_application_posting_id_aura-farmer_job_posting_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."aura-farmer_job_posting"("id") ON DELETE set null ON UPDATE no action;
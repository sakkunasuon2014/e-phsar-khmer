CREATE TYPE "public"."job_application_status" AS ENUM('pending', 'viewed', 'hired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."listing_event_type" AS ENUM('impression', 'view', 'chat', 'call', 'show_contact', 'apply_job');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "banned_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(32) NOT NULL,
	"user_id" uuid,
	"report_id" uuid,
	"banned_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"resume_id" uuid,
	"object_key" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"declared_size" integer NOT NULL,
	"actual_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_at" timestamp with time zone,
	"attached_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_educations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resume_id" uuid NOT NULL,
	"school" varchar(100) NOT NULL,
	"degree" varchar(40) NOT NULL,
	"major" varchar(100) NOT NULL,
	"province_id" uuid,
	"district_id" uuid,
	"commune_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_educations_dates_ordered" CHECK (end_date is null or end_date >= start_date),
	CONSTRAINT "resume_educations_current_no_end" CHECK (not is_current or end_date is null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resume_id" uuid NOT NULL,
	"company" varchar(100) NOT NULL,
	"position" varchar(100) NOT NULL,
	"province_id" uuid,
	"district_id" uuid,
	"commune_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_experiences_dates_ordered" CHECK (end_date is null or end_date >= start_date),
	CONSTRAINT "resume_experiences_current_no_end" CHECK (not is_current or end_date is null)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_job_preferences" (
	"resume_id" uuid PRIMARY KEY NOT NULL,
	"open_job" boolean DEFAULT false NOT NULL,
	"position" varchar(100),
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resume_id" uuid NOT NULL,
	"title" varchar(50) NOT NULL,
	"level" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_personal" (
	"resume_id" uuid PRIMARY KEY NOT NULL,
	"first_name" varchar(50) NOT NULL,
	"last_name" varchar(50) NOT NULL,
	"gender" varchar(20),
	"dob" date,
	"nationality" varchar(50),
	"email" varchar(254),
	"education_level" varchar(40),
	"marital_status" varchar(20),
	"province_id" uuid,
	"district_id" uuid,
	"commune_id" uuid,
	"address" varchar(200),
	"position" varchar(100),
	"years_of_experience" integer,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_personal_years_range" CHECK (years_of_experience is null or years_of_experience between 0 and 60),
	CONSTRAINT "resume_personal_phones_max" CHECK (jsonb_array_length(phones) <= 3)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resume_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"company" varchar(100) NOT NULL,
	"position" varchar(100) NOT NULL,
	"phones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email" varchar(254),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_references_phones_max" CHECK (jsonb_array_length(phones) <= 3)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resume_id" uuid NOT NULL,
	"title" varchar(50) NOT NULL,
	"level" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"hobbies" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"poster_id" uuid NOT NULL,
	"cover_note" text,
	"resume_snapshot" jsonb,
	"status" "job_application_status" DEFAULT 'pending' NOT NULL,
	"viewed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_not_self" CHECK (applicant_id <> poster_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"actor_id" uuid,
	"event_type" "listing_event_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_login_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" varchar(128) NOT NULL,
	"device_name" varchar(120),
	"client_type" varchar(16),
	"browser_name" varchar(40),
	"browser_version" varchar(40),
	"os_name" varchar(40),
	"os_version" varchar(40),
	"device_model" varchar(80),
	"client_version" varchar(40),
	"user_agent" varchar(512),
	"session_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"revoked_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discoverable_by_gender" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discoverable_by_date_of_birth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discoverable_by_phone" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discoverable_by_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "discoverable_by_location" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "attribute_options" ADD COLUMN IF NOT EXISTS "name_km" varchar(160);--> statement-breakpoint
ALTER TABLE "listing_reports" ADD COLUMN IF NOT EXISTS "image_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "banned_phones" ADD CONSTRAINT "banned_phones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "banned_phones" ADD CONSTRAINT "banned_phones_report_id_user_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."user_reports"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "banned_phones" ADD CONSTRAINT "banned_phones_banned_by_id_users_id_fk" FOREIGN KEY ("banned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_attachments" ADD CONSTRAINT "resume_attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_attachments" ADD CONSTRAINT "resume_attachments_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_educations" ADD CONSTRAINT "resume_educations_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_educations" ADD CONSTRAINT "resume_educations_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_educations" ADD CONSTRAINT "resume_educations_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_educations" ADD CONSTRAINT "resume_educations_commune_id_communes_id_fk" FOREIGN KEY ("commune_id") REFERENCES "public"."communes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_experiences" ADD CONSTRAINT "resume_experiences_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_experiences" ADD CONSTRAINT "resume_experiences_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_experiences" ADD CONSTRAINT "resume_experiences_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_experiences" ADD CONSTRAINT "resume_experiences_commune_id_communes_id_fk" FOREIGN KEY ("commune_id") REFERENCES "public"."communes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_job_preferences" ADD CONSTRAINT "resume_job_preferences_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_languages" ADD CONSTRAINT "resume_languages_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_personal" ADD CONSTRAINT "resume_personal_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_personal" ADD CONSTRAINT "resume_personal_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_personal" ADD CONSTRAINT "resume_personal_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_personal" ADD CONSTRAINT "resume_personal_commune_id_communes_id_fk" FOREIGN KEY ("commune_id") REFERENCES "public"."communes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_references" ADD CONSTRAINT "resume_references_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_skills" ADD CONSTRAINT "resume_skills_resume_id_resumes_id_fk" FOREIGN KEY ("resume_id") REFERENCES "public"."resumes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_applicant_id_users_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_poster_id_users_id_fk" FOREIGN KEY ("poster_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_events" ADD CONSTRAINT "listing_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_login_devices" ADD CONSTRAINT "user_login_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "banned_phones_phone_uq" ON "banned_phones" USING btree ("phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "banned_phones_user_id_idx" ON "banned_phones" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "banned_phones_report_id_idx" ON "banned_phones" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_attachments_resume_idx" ON "resume_attachments" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_attachments_orphan_idx" ON "resume_attachments" USING btree ("created_at") WHERE resume_id is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_attachments_user_created_idx" ON "resume_attachments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_educations_resume_id_idx" ON "resume_educations" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_experiences_resume_id_idx" ON "resume_experiences" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_languages_resume_id_idx" ON "resume_languages" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_references_resume_id_idx" ON "resume_references" USING btree ("resume_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_skills_resume_id_idx" ON "resume_skills" USING btree ("resume_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resumes_user_id_uq" ON "resumes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_applications_listing_applicant_uq" ON "job_applications" USING btree ("listing_id","applicant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_applications_poster_created_idx" ON "job_applications" USING btree ("poster_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_applications_applicant_created_idx" ON "job_applications" USING btree ("applicant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_events_owner_type_idx" ON "listing_events" USING btree ("owner_id","event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_events_listing_id_idx" ON "listing_events" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_login_devices_user_device_uq" ON "user_login_devices" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_login_devices_user_session_uq" ON "user_login_devices" USING btree ("user_id","session_id");
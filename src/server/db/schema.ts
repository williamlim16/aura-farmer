// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { relations } from "drizzle-orm";
import { index, pgTableCreator } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `aura-farmer_${name}`);

export const posts = createTable(
  "post",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    name: d.varchar({ length: 256 }),
    createdAt: d
      .timestamp({ withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
  }),
  (t) => [index("name_idx").on(t.name)],
);

/** Core candidate details and personal summary tied 1:1 to a Supabase user ID. */
export const userProfiles = createTable(
  "user_profile",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    userId: d.uuid("user_id").notNull().unique(),
    fullName: d.varchar("full_name", { length: 256 }),
    headline: d.varchar("headline", { length: 256 }),
    location: d.varchar("location", { length: 256 }),
    phone: d.varchar("phone", { length: 64 }),
    websiteUrl: d.varchar("website_url", { length: 512 }),
    linkedinUrl: d.varchar("linkedin_url", { length: 512 }),
    githubUrl: d.varchar("github_url", { length: 512 }),
    summary: d.text("summary"),
    skills: d.text("skills"),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d
      .timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date()),
  }),
  (t) => [index("user_profile_user_id_idx").on(t.userId)],
);

/** Work experience entries owned by the authenticated user. */
export const experiences = createTable(
  "experience",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    userId: d.uuid("user_id").notNull(),
    jobTitle: d.varchar("job_title", { length: 256 }).notNull(),
    company: d.varchar("company", { length: 256 }).notNull(),
    employmentType: d.varchar("employment_type", { length: 128 }),
    location: d.varchar("location", { length: 256 }),
    startDate: d.varchar("start_date", { length: 64 }).notNull(),
    endDate: d.varchar("end_date", { length: 64 }),
    isCurrent: d.boolean("is_current").default(false).notNull(),
    description: d.text("description"),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d
      .timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date()),
  }),
  (t) => [index("experience_user_id_idx").on(t.userId)],
);

/** Education entries owned by the authenticated user. */
export const educations = createTable(
  "education",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    userId: d.uuid("user_id").notNull(),
    school: d.varchar("school", { length: 256 }).notNull(),
    degree: d.varchar("degree", { length: 256 }).notNull(),
    fieldOfStudy: d.varchar("field_of_study", { length: 256 }),
    location: d.varchar("location", { length: 256 }),
    startDate: d.varchar("start_date", { length: 64 }).notNull(),
    endDate: d.varchar("end_date", { length: 64 }),
    isCurrent: d.boolean("is_current").default(false).notNull(),
    grade: d.varchar("grade", { length: 128 }),
    description: d.text("description"),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d
      .timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date()),
  }),
  (t) => [index("education_user_id_idx").on(t.userId)],
);

/** Uploaded resume files stored in Supabase Storage and owned by the authenticated user. */
export const resumes = createTable(
  "resume",
  (d) => ({
    id: d.uuid().primaryKey().defaultRandom(),
    userId: d.uuid("user_id").notNull(),
    fileName: d.varchar("file_name", { length: 512 }).notNull(),
    storagePath: d.varchar("storage_path", { length: 1024 }).notNull(),
    bucketId: d
      .varchar("bucket_id", { length: 256 })
      .default("aura-farmer-bucket")
      .notNull(),
    mimeType: d.varchar("mime_type", { length: 128 }).notNull(),
    fileSize: d.integer("file_size").notNull(),
    createdAt: d
      .timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
    updatedAt: d
      .timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date()),
  }),
  (t) => [index("resume_user_id_idx").on(t.userId)],
);

export const userProfilesRelations = relations(userProfiles, ({ many }) => ({
  experiences: many(experiences),
  educations: many(educations),
  resumes: many(resumes),
}));

export const experiencesRelations = relations(experiences, ({ one }) => ({
  profile: one(userProfiles, {
    fields: [experiences.userId],
    references: [userProfiles.userId],
  }),
}));

export const educationsRelations = relations(educations, ({ one }) => ({
  profile: one(userProfiles, {
    fields: [educations.userId],
    references: [userProfiles.userId],
  }),
}));

export const resumesRelations = relations(resumes, ({ one }) => ({
  profile: one(userProfiles, {
    fields: [resumes.userId],
    references: [userProfiles.userId],
  }),
}));

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
export type Education = typeof educations.$inferSelect;
export type NewEducation = typeof educations.$inferInsert;
export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;

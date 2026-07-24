import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const assessmentPlans = sqliteTable("assessment_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subject: text("subject").notNull(),
  unit: text("unit").notNull(),
  goal: text("goal").notNull(),
  domain: text("domain").notNull(),
  assessmentType: text("assessment_type").notNull(),
  perspective: text("perspective").notNull(),
  high: text("high").notNull(),
  middle: text("middle").notNull(),
  low: text("low").notNull(),
  caution: text("caution").notNull(),
  sortOrder: integer("sort_order").notNull(),
}, (table) => [
  uniqueIndex("assessment_plans_content_idx").on(table.subject, table.unit, table.goal),
]);

export const generatedComments = sqliteTable("generated_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id").notNull(),
  subject: text("subject").notNull(),
  comment: text("comment").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("generated_comments_student_subject_idx").on(table.studentId, table.subject),
]);

export const studentBehaviors = sqliteTable("student_behaviors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id").notNull(),
  characteristic: text("characteristic").notNull(),
  behavior: text("behavior").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("student_behaviors_student_idx").on(table.studentId),
]);

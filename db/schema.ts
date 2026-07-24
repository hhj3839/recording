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

export const students = sqliteTable("students", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: integer("number").notNull(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("students_number_idx").on(table.number),
]);

export const assessmentLevels = sqliteTable("assessment_levels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id").notNull(),
  subject: text("subject").notNull(),
  assessmentIndex: integer("assessment_index").notNull(),
  level: text("level").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("assessment_levels_student_subject_item_idx").on(table.studentId, table.subject, table.assessmentIndex),
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

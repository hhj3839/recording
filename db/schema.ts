import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const teachers = sqliteTable("teachers", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const classrooms = sqliteTable("classrooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  schoolName: text("school_name").notNull(),
  schoolYear: integer("school_year").notNull(),
  semester: integer("semester").notNull(),
  grade: integer("grade").notNull(),
  classNumber: integer("class_number").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("classrooms_owner_period_idx").on(table.ownerEmail, table.schoolYear, table.semester, table.grade, table.classNumber),
]);

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
  ownerEmail: text("owner_email").notNull().default("__template__"),
  classId: integer("class_id").notNull().default(0),
}, (table) => [
  uniqueIndex("assessment_plans_content_idx").on(table.classId, table.subject, table.unit, table.goal),
]);

export const students = sqliteTable("students", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: integer("number").notNull(),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  ownerEmail: text("owner_email").notNull().default("__template__"),
  classId: integer("class_id").notNull().default(0),
}, (table) => [
  uniqueIndex("students_number_idx").on(table.classId, table.number),
]);

export const assessmentLevels = sqliteTable("assessment_levels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id").notNull(),
  subject: text("subject").notNull(),
  assessmentIndex: integer("assessment_index").notNull(),
  level: text("level").notNull(),
  updatedAt: text("updated_at").notNull(),
  ownerEmail: text("owner_email").notNull().default("__legacy__"),
  classId: integer("class_id").notNull().default(0),
}, (table) => [
  uniqueIndex("assessment_levels_student_subject_item_idx").on(table.classId, table.studentId, table.subject, table.assessmentIndex),
]);

export const generatedComments = sqliteTable("generated_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id").notNull(),
  subject: text("subject").notNull(),
  comment: text("comment").notNull(),
  updatedAt: text("updated_at").notNull(),
  ownerEmail: text("owner_email").notNull().default("__legacy__"),
  classId: integer("class_id").notNull().default(0),
}, (table) => [
  uniqueIndex("generated_comments_student_subject_idx").on(table.classId, table.studentId, table.subject),
]);

export const studentBehaviors = sqliteTable("student_behaviors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id").notNull(),
  characteristic: text("characteristic").notNull(),
  behavior: text("behavior").notNull(),
  updatedAt: text("updated_at").notNull(),
  ownerEmail: text("owner_email").notNull().default("__legacy__"),
  classId: integer("class_id").notNull().default(0),
}, (table) => [
  uniqueIndex("student_behaviors_student_idx").on(table.classId, table.studentId),
]);

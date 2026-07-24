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

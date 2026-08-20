/**
 * Tables whose rows belong to one teacher classroom.
 *
 * Keep destructive classroom and privacy deletion flows on this shared list so
 * a newly introduced class-scoped table cannot be forgotten in only one route.
 * Organization-wide shared plans are intentionally excluded.
 */
export const CLASS_DATA_TABLES = [
  "assessment_levels",
  "generated_comment_parts",
  "generated_comments",
  "student_behaviors",
  "record_revisions",
  "generation_jobs",
  "assessment_plan_versions",
  "pilot_feedback",
  "assessment_plan_pool_links",
  "assessment_plans",
  "students",
  "ai_usage_events",
] as const;

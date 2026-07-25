alter table assessment_levels
  drop constraint if exists assessment_levels_level_check;

alter table assessment_levels
  add constraint assessment_levels_level_check
  check (level in ('상', '중', '하', '미응시', '평가 예정', '-'));

alter table generation_jobs drop constraint if exists generation_jobs_job_type_check;
alter table generation_jobs
  add constraint generation_jobs_job_type_check
  check (job_type in ('comments', 'behaviors'));

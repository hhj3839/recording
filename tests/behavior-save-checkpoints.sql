-- Run against an isolated database initialized with schema.sql, never production.
begin;
do $test$
declare
  owner_uuid uuid := gen_random_uuid();
  job_uuid uuid := gen_random_uuid();
  lease timestamptz := now();
  payload jsonb := '[{"student_id":2,"characteristic":"fixture","behavior":"first"}]';
begin
  insert into auth.users(id) values(owner_uuid);
  insert into public.generation_jobs(id,owner_id,owner_email,class_id,job_type,status,updated_at,batches)
    values(job_uuid,owner_uuid,'fixture@example.test',71,'behaviors','running',lease,'[[{"studentId":2},{"studentId":3}]]');
  insert into public.student_behaviors(owner_id,owner_email,class_id,student_id,characteristic,behavior)
    values(owner_uuid,'fixture@example.test',71,2,'fixture','previous');
  begin
    perform public.save_behavior_job_results(job_uuid,owner_uuid,71,0,lease,
      payload || '[{"student_id":99,"characteristic":"x","behavior":"invalid"}]'::jsonb);
    raise exception 'unexpected success' using errcode='XX000';
  exception when raise_exception then
    if sqlerrm <> 'Student outside claimed batch' then raise; end if;
  end;
  if (select behavior from public.student_behaviors where class_id=71 and student_id=2) <> 'previous'
    or exists(select from public.record_revisions where owner_id=owner_uuid)
    or (select behavior_save_receipts from public.generation_jobs where id=job_uuid) <> '{}'::jsonb
    then raise exception 'partial commit'; end if;
  perform public.save_behavior_job_results(job_uuid,owner_uuid,71,0,lease,payload);
  -- Simulate a manual edit following a committed write whose acknowledgement was lost.
  update public.student_behaviors set behavior='edited',confirmed=true where owner_id=owner_uuid;
  perform public.save_behavior_job_results(job_uuid,owner_uuid,71,0,lease,payload);
  if not exists(select from public.student_behaviors where owner_id=owner_uuid and confirmed and behavior='edited')
    or (select count(*) from public.record_revisions where owner_id=owner_uuid and content='previous') <> 1
    or (select behavior_save_receipts from public.generation_jobs where id=job_uuid) <> '{"0:2":true}'::jsonb
    then raise exception 'replay changed durable state'; end if;
  begin
    perform public.save_behavior_job_results(job_uuid,owner_uuid,71,0,lease - interval '1 second',payload);
    raise exception 'stale lease accepted';
  exception when no_data_found then null;
  end;
end;
$test$;
rollback;

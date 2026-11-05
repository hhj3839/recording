-- Deploy before the worker. A receipt belongs to one job, batch and student.
alter table public.generation_jobs add column if not exists behavior_save_receipts jsonb not null default '{}'::jsonb;

create or replace function public.save_behavior_job_results(
  p_job uuid, p_owner uuid, p_class bigint, p_batch integer, p_lease timestamptz, p_results jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  j public.generation_jobs%rowtype;
  item record;
  receipt text;
begin
  select * into strict j from public.generation_jobs
    where id=p_job and owner_id=p_owner and class_id=p_class and job_type='behaviors'
      and status='running' and current_batch=p_batch and updated_at=p_lease for update;
  for item in select * from jsonb_to_recordset(p_results)
      as r(student_id bigint, characteristic text, behavior text)
  loop
    if not exists (select 1 from jsonb_array_elements(j.batches->p_batch) e
                   where (e->>'studentId')::bigint=item.student_id) then
      raise exception 'Student outside claimed batch';
    end if;
    receipt := p_batch::text || ':' || item.student_id::text;
    if j.behavior_save_receipts ? receipt then continue; end if;
    insert into public.record_revisions(owner_id,owner_email,class_id,record_type,student_id,subject,
      content,characteristic,confirmed,source,created_at)
    select j.owner_id,j.owner_email,j.class_id,'behavior',item.student_id,'',b.behavior,b.characteristic,
      b.confirmed,'ai-regeneration',now() from public.student_behaviors b
      where b.owner_id=j.owner_id and b.class_id=j.class_id and b.student_id=item.student_id
        and b.behavior<>'' and (b.behavior,b.characteristic) is distinct from (item.behavior,item.characteristic);
    insert into public.student_behaviors as b(owner_id,owner_email,class_id,student_id,characteristic,
      generated_characteristic,behavior,confirmed,confirmed_at,updated_at)
    values(j.owner_id,j.owner_email,j.class_id,item.student_id,item.characteristic,item.characteristic,
      item.behavior,false,null,now())
    on conflict(class_id,student_id) do update set characteristic=excluded.characteristic,
      generated_characteristic=excluded.generated_characteristic, behavior=excluded.behavior,
      confirmed=false, confirmed_at=null, updated_at=excluded.updated_at where b.owner_id=j.owner_id;
    if not found then raise exception 'Behavior ownership mismatch'; end if;
    j.behavior_save_receipts := j.behavior_save_receipts || jsonb_build_object(receipt,true);
  end loop;
  update public.generation_jobs set behavior_save_receipts=j.behavior_save_receipts where id=j.id;
end;
$$;
revoke all on function public.save_behavior_job_results(uuid,uuid,bigint,integer,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.save_behavior_job_results(uuid,uuid,bigint,integer,timestamptz,jsonb) to service_role;

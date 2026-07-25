create or replace function reorder_students(p_owner_id uuid, p_class_id bigint, p_student_ids bigint[])
returns table(id bigint, number integer, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
begin
  select count(*) into expected_count
  from students
  where owner_id = p_owner_id and class_id = p_class_id and active = true;

  if expected_count <> coalesce(array_length(p_student_ids, 1), 0)
     or expected_count <> (select count(distinct value) from unnest(p_student_ids) as value)
     or exists (
       select 1 from unnest(p_student_ids) as value
       where not exists (
         select 1 from students
         where students.id = value
           and students.owner_id = p_owner_id
           and students.class_id = p_class_id
           and students.active = true
       )
     ) then
    raise exception '학생 순서 정보가 현재 학급 명단과 일치하지 않습니다.';
  end if;

  update students
  set number = 1000000 + positions.position
  from unnest(p_student_ids) with ordinality as positions(student_id, position)
  where students.id = positions.student_id
    and students.owner_id = p_owner_id
    and students.class_id = p_class_id;

  update students
  set number = positions.position
  from unnest(p_student_ids) with ordinality as positions(student_id, position)
  where students.id = positions.student_id
    and students.owner_id = p_owner_id
    and students.class_id = p_class_id;

  return query
  select students.id, students.number, students.name
  from students
  where students.owner_id = p_owner_id
    and students.class_id = p_class_id
    and students.active = true
  order by students.number;
end;
$$;

revoke all on function reorder_students(uuid, bigint, bigint[]) from public, anon, authenticated;

alter table teachers add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table classrooms add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table assessment_plans add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table students add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table assessment_levels add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table generated_comments add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table student_behaviors add column if not exists owner_id uuid references auth.users(id) on delete cascade;

update teachers t set user_id = u.id from auth.users u where lower(t.email) = lower(u.email) and t.user_id is null;
update classrooms c set owner_id = u.id from auth.users u where lower(c.owner_email) = lower(u.email) and c.owner_id is null;
update assessment_plans p set owner_id = c.owner_id from classrooms c where p.class_id = c.id and p.owner_id is null;
update students s set owner_id = c.owner_id from classrooms c where s.class_id = c.id and s.owner_id is null;
update assessment_levels l set owner_id = c.owner_id from classrooms c where l.class_id = c.id and l.owner_id is null;
update generated_comments g set owner_id = c.owner_id from classrooms c where g.class_id = c.id and g.owner_id is null;
update student_behaviors b set owner_id = c.owner_id from classrooms c where b.class_id = c.id and b.owner_id is null;

create unique index if not exists teachers_user_id_unique on teachers(user_id) where user_id is not null;
create unique index if not exists classrooms_owner_scope_unique on classrooms(owner_id, school_year, semester, grade, class_number) where owner_id is not null;
create index if not exists students_owner_class_idx on students(owner_id, class_id);
create index if not exists assessment_levels_owner_class_idx on assessment_levels(owner_id, class_id);
create index if not exists generated_comments_owner_class_idx on generated_comments(owner_id, class_id);
create index if not exists student_behaviors_owner_class_idx on student_behaviors(owner_id, class_id);

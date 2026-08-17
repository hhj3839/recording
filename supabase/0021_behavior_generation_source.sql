alter table student_behaviors
  add column if not exists generated_characteristic text;

update student_behaviors
set generated_characteristic = characteristic
where behavior <> ''
  and generated_characteristic is null;

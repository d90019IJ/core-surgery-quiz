-- Private eligibility roster. Empty rosters deny admission.
create table public.core_quiz_roster (
  exam_id text not null references public.core_quiz_exams(id),
  student_id text not null,
  name text not null,
  group_name text not null check (group_name = 'B'),
  primary key (exam_id, student_id)
);
alter table public.core_quiz_roster enable row level security;
revoke all on public.core_quiz_roster from public, anon, authenticated;
grant select on public.core_quiz_roster to service_role;
create function public.core_quiz_authorize(p_exam_id text, p_student_id text, p_name text)
returns text language sql stable security invoker set search_path = '' as $$
  select name from public.core_quiz_roster
  where exam_id = p_exam_id and student_id = p_student_id
    and name = p_name and group_name = 'B';
$$;
revoke all on function public.core_quiz_authorize(text,text,text) from public, anon, authenticated;
grant execute on function public.core_quiz_authorize(text,text,text) to service_role;
create function public.core_quiz_check_roster()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if public.core_quiz_authorize(new.exam_id,new.student_id,new.name) is null then
      raise exception 'ROSTER_DENIED';
    end if;
  elsif not old.survey_complete and new.survey_complete then
    if not exists (select 1 from public.core_quiz_roster
      where exam_id = new.exam_id and student_id = new.student_id and group_name = 'B') then
      raise exception 'ROSTER_DENIED';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.core_quiz_check_roster() from public, anon, authenticated;
grant execute on function public.core_quiz_check_roster() to service_role;
create trigger core_quiz_roster_guard before insert or update of survey_complete
  on public.core_quiz_submissions for each row execute function public.core_quiz_check_roster();

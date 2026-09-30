-- Apply after schema.sql. Existing attempts are retained and need a survey.
alter table public.core_quiz_exams add column opens_at timestamptz;
alter table public.core_quiz_exams add column closes_at timestamptz;
alter table public.core_quiz_exams add constraint core_quiz_schedule_valid check (
  (opens_at is null and closes_at is null) or
  (opens_at is not null and closes_at is not null and opens_at < closes_at)
);
alter table public.core_quiz_submissions add column survey_complete boolean not null default false;
alter table public.core_quiz_submissions alter column submitted_at set default clock_timestamp();
grant update (survey_complete) on public.core_quiz_submissions to service_role;

-- Only aggregate bins: no student ID, submission ID, response ID or timestamp.
create table public.core_quiz_survey_counts (
  exam_id text not null references public.core_quiz_exams(id),
  item_id text not null check (item_id in ('s1','s2','s3','s4','s5')),
  choice smallint not null check (choice between 0 and 4),
  response_count integer not null check (response_count > 0),
  primary key (exam_id, item_id, choice)
);
alter table public.core_quiz_survey_counts enable row level security;
revoke all on public.core_quiz_survey_counts from public, anon, authenticated;
grant select, insert, update on public.core_quiz_survey_counts to service_role;

create function public.core_quiz_context(p_exam_id text)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('id',id,'title',title,'open',open,'questions',questions,
    'opens_at',opens_at,'closes_at',closes_at,'server_now',clock_timestamp())
  from public.core_quiz_exams where id=p_exam_id;
$$;
revoke all on function public.core_quiz_context(text) from public, anon, authenticated;
grant execute on function public.core_quiz_context(text) to service_role;

-- Executed at the actual insertion, including by older deployed API versions.
create function public.core_quiz_check_deadline() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare e public.core_quiz_exams%rowtype;
begin
  select * into e from public.core_quiz_exams where id=new.exam_id for share;
  if not found or not e.open or e.opens_at is null or e.closes_at is null
    or clock_timestamp() < e.opens_at or clock_timestamp() >= e.closes_at then
    raise exception 'EXAM_CLOSED';
  end if;
  new.submitted_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.core_quiz_check_deadline() from public, anon, authenticated;
grant execute on function public.core_quiz_check_deadline() to service_role;
create trigger core_quiz_submission_deadline before insert on public.core_quiz_submissions
for each row execute function public.core_quiz_check_deadline();

create function public.core_quiz_survey_submit(p_exam_id text, p_student_id text, p_answers jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare e public.core_quiz_exams%rowtype; complete boolean; item text; choice_value integer;
begin
  select * into e from public.core_quiz_exams where id=p_exam_id for share;
  if not found then raise exception 'EXAM_CLOSED'; end if;
  -- Same lock order as exam submission; serialize retries for the same learner.
  select survey_complete into complete from public.core_quiz_submissions
    where exam_id=p_exam_id and student_id=p_student_id for update;
  if not found then raise exception 'QUIZ_REQUIRED'; end if;
  if complete then return true; end if;
  if not e.open or e.opens_at is null or e.closes_at is null
    or clock_timestamp() < e.opens_at or clock_timestamp() >= e.closes_at then
    raise exception 'EXAM_CLOSED';
  end if;
  if p_answers is null or jsonb_typeof(p_answers)<>'object' then raise exception 'INVALID_ANSWERS'; end if;
  if (select count(*) from jsonb_object_keys(p_answers))<>5 then raise exception 'INVALID_ANSWERS'; end if;
  foreach item in array array['s1','s2','s3','s4','s5'] loop
    if not (p_answers ? item) or jsonb_typeof(p_answers->item)<>'number'
      or (p_answers->>item) !~ '^[0-4]$' then raise exception 'INVALID_ANSWERS'; end if;
    choice_value := (p_answers->>item)::integer;
    insert into public.core_quiz_survey_counts(exam_id,item_id,choice,response_count)
      values(p_exam_id,item,choice_value,1)
      on conflict(exam_id,item_id,choice) do update
        set response_count=public.core_quiz_survey_counts.response_count+1;
  end loop;
  update public.core_quiz_submissions set survey_complete=true
    where exam_id=p_exam_id and student_id=p_student_id;
  -- A request blocked on a lock past the cutoff rolls back ALL its changes.
  if clock_timestamp() >= e.closes_at then raise exception 'EXAM_CLOSED'; end if;
  return true;
end;
$$;
revoke all on function public.core_quiz_survey_submit(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.core_quiz_survey_submit(text,text,jsonb) to service_role;

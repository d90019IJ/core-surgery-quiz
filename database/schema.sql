-- All client access goes through the narrow Edge Function API.
-- This file intentionally contains no real answers or teacher credentials.
create table public.core_quiz_settings (
  id smallint primary key check (id = 1),
  admin_hash text not null check (admin_hash ~ '^[0-9a-f]{64}$'),
  allowed_origins text[] not null
);
create table public.core_quiz_exams (
  id text primary key check (id ~ '^[a-zA-Z0-9-]{1,80}$'),
  title text not null,
  open boolean not null default false,
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) > 0),
  answer_key jsonb not null check (jsonb_typeof(answer_key) = 'object'),
  created_at timestamptz not null default now()
);
create table public.core_quiz_submissions (
  exam_id text not null references public.core_quiz_exams(id),
  student_id text not null check (student_id ~ '^[A-Z0-9][A-Z0-9-]{0,31}$'),
  name text not null check (char_length(name) between 1 and 60),
  answers jsonb not null,
  score integer not null check (score between 0 and 100),
  submitted_at timestamptz not null default now(),
  primary key (exam_id, student_id)
);
create index core_quiz_submissions_time on public.core_quiz_submissions (exam_id, submitted_at, student_id);
alter table public.core_quiz_settings enable row level security;
alter table public.core_quiz_exams enable row level security;
alter table public.core_quiz_submissions enable row level security;
revoke all on public.core_quiz_settings, public.core_quiz_exams, public.core_quiz_submissions from public, anon, authenticated;
grant select on public.core_quiz_settings to service_role;
grant select, update on public.core_quiz_exams to service_role;
grant select, insert on public.core_quiz_submissions to service_role;

-- The lock makes closing an exam and accepting a submission transactional.
-- The primary key makes simultaneous duplicate requests safe.
create function public.core_quiz_submit(p_exam_id text, p_student_id text, p_name text, p_answers jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare e public.core_quiz_exams%rowtype; q jsonb; points integer := 0; total integer;
begin
  select * into e from public.core_quiz_exams where id = p_exam_id for share;
  if not found then raise exception 'EXAM_CLOSED'; end if;
  if exists (select 1 from public.core_quiz_submissions where exam_id = p_exam_id and student_id = p_student_id) then return true; end if;
  if not e.open then raise exception 'EXAM_CLOSED'; end if;
  total := jsonb_array_length(e.questions);
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'INVALID_ANSWERS'; end if;
  if (select count(*) from jsonb_object_keys(p_answers)) <> total then raise exception 'INVALID_ANSWERS'; end if;
  for q in select value from jsonb_array_elements(e.questions) loop
    if not (p_answers ? (q->>'id')) or jsonb_typeof(p_answers->(q->>'id')) <> 'number'
      or (p_answers->>(q->>'id')) !~ '^[0-9]+$'
      or (p_answers->>(q->>'id'))::numeric >= jsonb_array_length(q->'options') then
      raise exception 'INVALID_ANSWERS';
    end if;
    if p_answers->(q->>'id') = e.answer_key->(q->>'id') then points := points + 1; end if;
  end loop;
  insert into public.core_quiz_submissions (exam_id, student_id, name, answers, score)
  values (p_exam_id, p_student_id, p_name, p_answers, round(points * 100.0 / total))
  on conflict (exam_id, student_id) do nothing;
  return true;
end;
$$;
revoke all on function public.core_quiz_submit(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.core_quiz_submit(text,text,text,jsonb) to service_role;

alter table public.core_quiz_submissions add column question_ids text[];
-- Optional rules leave all existing fixed exams unchanged.
alter table public.core_quiz_exams add column assignment_rules jsonb;
alter table public.core_quiz_exams add constraint core_quiz_rules_array
  check (assignment_rules is null or (jsonb_typeof(assignment_rules)='array' and jsonb_array_length(assignment_rules)>0));
create table public.core_quiz_assignments (
  exam_id text not null references public.core_quiz_exams(id),
  student_id text not null,
  questions jsonb not null,
  answer_key jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(exam_id,student_id)
);
alter table public.core_quiz_assignments enable row level security;
revoke all on public.core_quiz_assignments from public,anon,authenticated,service_role;
grant select,insert on public.core_quiz_assignments to service_role;

-- Teacher previews call this without assigning a student or changing state.
create function public.core_quiz_pick_questions(p_exam_id text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.core_quiz_exams%rowtype; rule jsonb; picked jsonb; result jsonb := '[]'; n integer;
begin
  select * into e from public.core_quiz_exams where id=p_exam_id;
  if not found then raise exception 'EXAM_CLOSED'; end if;
  if e.assignment_rules is null then return e.questions; end if;
  for rule in select value from jsonb_array_elements(e.assignment_rules) loop
    if jsonb_typeof(rule->'ids') is distinct from 'array'
      or coalesce(rule->>'count','') !~ '^[1-9][0-9]*$' then raise exception 'INVALID_RULES'; end if;
    n := (rule->>'count')::integer;
    select coalesce(jsonb_agg(q),'[]') into picked from (
      select value as q from jsonb_array_elements(e.questions)
      where (rule->'ids') ? (value->>'id') order by random() limit n
    ) choices;
    if jsonb_array_length(picked)<>n then raise exception 'INVALID_RULES'; end if;
    result := result || picked;
  end loop;
  if jsonb_array_length(result)<>(select count(distinct value->>'id') from jsonb_array_elements(result))
    then raise exception 'INVALID_RULES'; end if;
  select jsonb_agg(value order by random()) into result from jsonb_array_elements(result);
  return result;
end;
$$;
revoke all on function public.core_quiz_pick_questions(text) from public,anon,authenticated;
grant execute on function public.core_quiz_pick_questions(text) to service_role;

create function public.core_quiz_assign(p_exam_id text,p_student_id text,p_name text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.core_quiz_exams%rowtype; selected jsonb; keys jsonb;
begin
  select * into e from public.core_quiz_exams where id=p_exam_id for share;
  if not found then raise exception 'EXAM_CLOSED'; end if;
  if public.core_quiz_authorize(p_exam_id,p_student_id,p_name) is null then raise exception 'ROSTER_DENIED'; end if;
  if not e.open or e.opens_at is null or e.closes_at is null or clock_timestamp()<e.opens_at or clock_timestamp()>=e.closes_at then raise exception 'EXAM_CLOSED'; end if;
  if e.assignment_rules is null then return e.questions; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_exam_id || ':' || p_student_id,0));
  select a.questions into selected from public.core_quiz_assignments a where a.exam_id=p_exam_id and a.student_id=p_student_id;
  if found then return selected; end if;
  selected := public.core_quiz_pick_questions(p_exam_id);
  select jsonb_object_agg(value->>'id',e.answer_key->(value->>'id')) into keys from jsonb_array_elements(selected);
  if exists(select 1 from jsonb_each(keys) where value='null'::jsonb) then raise exception 'INVALID_RULES'; end if;
  if clock_timestamp()>=e.closes_at then raise exception 'EXAM_CLOSED'; end if;
  insert into public.core_quiz_assignments(exam_id,student_id,questions,answer_key) values(p_exam_id,p_student_id,selected,keys);
  return selected;
end;
$$;
revoke all on function public.core_quiz_assign(text,text,text) from public,anon,authenticated;
grant execute on function public.core_quiz_assign(text,text,text) to service_role;

create or replace function public.core_quiz_context(p_exam_id text)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('id',id,'title',title,'open',open,'questions',questions,
    'assignment_rules',assignment_rules,'opens_at',opens_at,'closes_at',closes_at,'server_now',clock_timestamp())
  from public.core_quiz_exams where id=p_exam_id;
$$;

create or replace function public.core_quiz_submit(p_exam_id text,p_student_id text,p_name text,p_answers jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.core_quiz_exams%rowtype; q jsonb; selected jsonb; keys jsonb; points integer:=0; total integer;
begin
  select * into e from public.core_quiz_exams where id=p_exam_id for share;
  if not found then raise exception 'EXAM_CLOSED'; end if;
  if public.core_quiz_authorize(p_exam_id,p_student_id,p_name) is null then raise exception 'ROSTER_DENIED'; end if;
  if exists(select 1 from public.core_quiz_submissions where exam_id=p_exam_id and student_id=p_student_id) then return true; end if;
  if not e.open or e.opens_at is null or e.closes_at is null or clock_timestamp()<e.opens_at or clock_timestamp()>=e.closes_at then raise exception 'EXAM_CLOSED'; end if;
  selected:=e.questions; keys:=e.answer_key;
  if e.assignment_rules is not null then
    select a.questions,a.answer_key into selected,keys from public.core_quiz_assignments a where a.exam_id=p_exam_id and a.student_id=p_student_id;
    if not found then raise exception 'ASSIGNMENT_REQUIRED'; end if;
  end if;
  total:=jsonb_array_length(selected);
  if p_answers is null or jsonb_typeof(p_answers)<>'object' or total=0 then raise exception 'INVALID_ANSWERS'; end if;
  if (select count(*) from jsonb_object_keys(p_answers))<>total then raise exception 'INVALID_ANSWERS'; end if;
  for q in select value from jsonb_array_elements(selected) loop
    if not(p_answers ? (q->>'id')) or jsonb_typeof(p_answers->(q->>'id'))<>'number'
      or (p_answers->>(q->>'id')) !~ '^[0-9]+$'
      or (p_answers->>(q->>'id'))::numeric>=jsonb_array_length(q->'options') then raise exception 'INVALID_ANSWERS'; end if;
    if p_answers->(q->>'id')=keys->(q->>'id') then points:=points+1; end if;
  end loop;
  insert into public.core_quiz_submissions(exam_id,student_id,name,answers,score,question_ids)
    values(p_exam_id,p_student_id,p_name,p_answers,round(points*100.0/total),array(select value->>'id' from jsonb_array_elements(selected)))
    on conflict(exam_id,student_id) do nothing;
  return true;
end;
$$;

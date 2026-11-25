-- Manual review keeps the final score NULL until all short answers are reviewed.
alter table public.core_quiz_submissions alter column score drop not null;
alter table public.core_quiz_submissions add column grading_status text not null default 'graded' check(grading_status in ('pending','graded'));
alter table public.core_quiz_submissions add column manual_grades jsonb;
alter table public.core_quiz_submissions add column review_note text;
alter table public.core_quiz_submissions add column reviewed_at timestamptz;
alter table public.core_quiz_submissions add constraint core_quiz_grade_state check ((grading_status='pending' and score is null) or (grading_status='graded' and score is not null));
grant update(score,grading_status,manual_grades,review_note,reviewed_at) on public.core_quiz_submissions to service_role;
create or replace function public.core_quiz_submit(p_exam_id text,p_student_id text,p_name text,p_answers jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.core_quiz_exams%rowtype; q jsonb; selected jsonb; keys jsonb; points integer:=0; total integer; supplied jsonb; normalized jsonb:='{}'; manual boolean:=false;
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
    supplied:=p_answers->(q->>'id');
    if supplied is null then raise exception 'INVALID_ANSWERS'; end if;
    if q->>'type'='short' then
      manual:=true;
      if jsonb_typeof(supplied)<>'array' then raise exception 'INVALID_ANSWERS'; end if;
      if jsonb_array_length(supplied)<>(q->>'fields')::integer then raise exception 'INVALID_ANSWERS'; end if;
      if exists(select 1 from jsonb_array_elements(supplied) item where jsonb_typeof(item)<>'string' or length(item#>>'{}')>800 or (item#>>'{}') !~ '[^[:space:]]') then raise exception 'INVALID_ANSWERS'; end if;
    elsif q->>'type'='multiple' then
      if jsonb_typeof(supplied)<>'array' then raise exception 'INVALID_ANSWERS'; end if;
      if jsonb_array_length(supplied)=0 or jsonb_array_length(supplied)>jsonb_array_length(q->'options') then raise exception 'INVALID_ANSWERS'; end if;
      if exists(select 1 from jsonb_array_elements(supplied) item
         where jsonb_typeof(item)<>'number' or item::text !~ '^[0-9]+$') then raise exception 'INVALID_ANSWERS'; end if;
      if exists(select 1 from jsonb_array_elements(supplied) item where item::text::numeric>=jsonb_array_length(q->'options')) then raise exception 'INVALID_ANSWERS'; end if;
      if jsonb_array_length(supplied)<>(select count(distinct item) from jsonb_array_elements(supplied) item) then raise exception 'INVALID_ANSWERS'; end if;
      select jsonb_agg(item order by item::text::numeric) into supplied from jsonb_array_elements(supplied) item;
      if jsonb_typeof(keys->(q->>'id'))='array' and supplied @> (keys->(q->>'id')) and supplied <@ (keys->(q->>'id')) then points:=points+1; end if;
    else
      if jsonb_typeof(supplied)<>'number' or supplied::text !~ '^[0-9]+$' then raise exception 'INVALID_ANSWERS'; end if;
      if supplied::text::numeric>=jsonb_array_length(q->'options') then raise exception 'INVALID_ANSWERS'; end if;
      if supplied=keys->(q->>'id') then points:=points+1; end if;
    end if;
    normalized:=normalized || jsonb_build_object(q->>'id',supplied);
  end loop;
  insert into public.core_quiz_submissions(exam_id,student_id,name,answers,score,question_ids,grading_status)
    values(p_exam_id,p_student_id,p_name,normalized,case when manual then null else round(points*100.0/total) end,array(select value->>'id' from jsonb_array_elements(selected)),case when manual then 'pending' else 'graded' end)
    on conflict(exam_id,student_id) do nothing;
  return true;
end;
$$;

create or replace function public.core_quiz_pick_questions(p_exam_id text)
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
  -- Explicit display_order permits linked cases to stay adjacent.
  if not exists(select 1 from jsonb_array_elements(result) where not(value ? 'display_order')) then
    select jsonb_agg(value order by (value->>'display_order')::integer) into result from jsonb_array_elements(result);
  else
    select jsonb_agg(value order by random()) into result from jsonb_array_elements(result);
  end if;
  return result;
end;
$$;
revoke all on function public.core_quiz_pick_questions(text) from public,anon,authenticated;
grant execute on function public.core_quiz_pick_questions(text) to service_role;


create or replace function public.core_quiz_grade(p_exam_id text,p_student_id text,p_grades jsonb,p_note text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.core_quiz_submissions%rowtype; a public.core_quiz_assignments%rowtype; q jsonb; g jsonb; points numeric:=0; manual_count integer:=0;
begin
 select * into r from public.core_quiz_submissions where exam_id=p_exam_id and student_id=p_student_id for update;
 if not found then raise exception 'QUIZ_REQUIRED'; end if;
 select * into a from public.core_quiz_assignments where exam_id=p_exam_id and student_id=p_student_id;
 if not found then raise exception 'INVALID_GRADES'; end if;
 if p_grades is null or jsonb_typeof(p_grades)<>'object' or p_note is null or length(p_note)>2000 then raise exception 'INVALID_GRADES'; end if;
 for q in select value from jsonb_array_elements(a.questions) loop
   if q->>'type'='short' then
     manual_count:=manual_count+1;g:=p_grades->(q->>'id');
     if g is null or jsonb_typeof(g)<>'array' then raise exception 'INVALID_GRADES'; end if;
     if jsonb_array_length(g)<>(q->>'fields')::integer then raise exception 'INVALID_GRADES'; end if;
     if exists(select 1 from jsonb_array_elements(g) v where v not in ('0'::jsonb,'1'::jsonb)) then raise exception 'INVALID_GRADES'; end if;
     points:=points+(select sum(v::text::numeric) from jsonb_array_elements(g) v)/(q->>'fields')::integer;
   elsif r.answers->(q->>'id')=a.answer_key->(q->>'id') then
     points:=points+1;
   end if;
 end loop;
 if manual_count=0 or manual_count<>(select count(*) from jsonb_object_keys(p_grades)) then raise exception 'INVALID_GRADES'; end if;
 update public.core_quiz_submissions set score=round(points*100.0/jsonb_array_length(a.questions)),grading_status='graded',manual_grades=p_grades,review_note=p_note,reviewed_at=clock_timestamp() where exam_id=p_exam_id and student_id=p_student_id;
 return true;
end;
$$;
revoke all on function public.core_quiz_grade(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.core_quiz_grade(text,text,jsonb,text) to service_role;

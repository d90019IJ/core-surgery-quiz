create or replace function public.core_quiz_submit(p_exam_id text,p_student_id text,p_name text,p_answers jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.core_quiz_exams%rowtype; q jsonb; selected jsonb; keys jsonb; points integer:=0; total integer; supplied jsonb; normalized jsonb:='{}';
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
    if q->>'type'='multiple' then
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
  insert into public.core_quiz_submissions(exam_id,student_id,name,answers,score,question_ids)
    values(p_exam_id,p_student_id,p_name,normalized,round(points*100.0/total),array(select value->>'id' from jsonb_array_elements(selected)))
    on conflict(exam_id,student_id) do nothing;
  return true;
end;
$$;


-- Synthetic records only; everything is rolled back.
begin;
do $$
declare eid text := 'sql-qa-' || gen_random_uuid()::text; n integer; done boolean;
begin
  insert into public.core_quiz_exams(id,title,open,questions,answer_key,opens_at,closes_at)
    values(eid,'Synthetic boundary test',true,'[{"id":"q1","text":"Synthetic","options":["A","B"]}]','{"q1":0}',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 minute');
  insert into public.core_quiz_roster(exam_id,student_id,name,group_name) select eid,id,'Synthetic','B' from unnest(array['A','B','C']) as id;
  perform public.core_quiz_submit(eid,'A','Synthetic','{"q1":0}');
  begin
    perform public.core_quiz_survey_submit(eid,'A','{"s1":0,"s2":0,"s3":0,"s4":0,"s5":9}');
    raise exception 'invalid survey accepted';
  exception when others then
    if sqlerrm <> 'INVALID_ANSWERS' then raise; end if;
  end;
  select count(*) into n from public.core_quiz_survey_counts where exam_id=eid;
  if n<>0 then raise exception 'partial survey was not rolled back'; end if;
  select survey_complete into done from public.core_quiz_submissions where exam_id=eid and student_id='A';
  if done then raise exception 'invalid survey marked complete'; end if;
  perform public.core_quiz_survey_submit(eid,'A','{"s1":0,"s2":1,"s3":2,"s4":3,"s5":4}');
  perform public.core_quiz_survey_submit(eid,'A','{"s1":4,"s2":4,"s3":4,"s4":4,"s5":4}');
  select sum(response_count) into n from public.core_quiz_survey_counts where exam_id=eid;
  if n<>5 then raise exception 'duplicate survey changed counts'; end if;
  perform public.core_quiz_submit(eid,'B','Synthetic','{"q1":0}');
  update public.core_quiz_exams set closes_at=clock_timestamp()-interval '1 millisecond' where id=eid;
  begin
    perform public.core_quiz_submit(eid,'C','Synthetic','{"q1":0}');
    raise exception 'late quiz accepted';
  exception when others then
    if sqlerrm <> 'EXAM_CLOSED' then raise; end if;
  end;
  begin
    perform public.core_quiz_survey_submit(eid,'B','{"s1":0,"s2":0,"s3":0,"s4":0,"s5":0}');
    raise exception 'late survey accepted';
  exception when others then
    if sqlerrm <> 'EXAM_CLOSED' then raise; end if;
  end;
  select survey_complete into done from public.core_quiz_submissions where exam_id=eid and student_id='B';
  if done then raise exception 'late survey marked complete'; end if;
  if has_function_privilege('anon','public.core_quiz_survey_submit(text,text,jsonb)','EXECUTE') or
     has_function_privilege('authenticated','public.core_quiz_survey_submit(text,text,jsonb)','EXECUTE') then
    raise exception 'client can call privileged survey function';
  end if;
end;
$$;
rollback;
select 'passed: transactional rollback, idempotency, quiz deadline, survey deadline, restricted access' as verification;

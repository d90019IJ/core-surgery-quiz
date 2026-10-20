begin;
do $$
declare eid text:='multi-qa-'||gen_random_uuid()::text; value jsonb; score_value integer;
begin
insert into public.core_quiz_exams(id,title,open,questions,answer_key,opens_at,closes_at)
values(eid,'Synthetic multiple test',true,'[{"id":"s","text":"Single","options":["A","B"]},{"id":"m","type":"multiple","text":"Multi","options":["A","B","C","D","E"]}]','{"s":0,"m":[0,1,2,3]}',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 minute');
insert into public.core_quiz_roster(exam_id,student_id,name,group_name) select eid,id,'Synthetic','B' from unnest(array['A','B','C','D']) id;
for value in select v from jsonb_array_elements('[[],[0,0],[0,5],["0",1],[0,null],0,null]') v loop
begin
perform public.core_quiz_submit(eid,'D','Synthetic',jsonb_build_object('s',0,'m',value));
raise exception 'invalid multiple accepted';
exception when others then if sqlerrm<>'INVALID_ANSWERS' then raise;end if;end;
end loop;
perform public.core_quiz_submit(eid,'A','Synthetic','{"s":0,"m":[3,2,1,0]}');
select score into score_value from public.core_quiz_submissions where exam_id=eid and student_id='A';
if score_value<>100 then raise exception 'correct reversed set failed';end if;
if (select answers->'m' from public.core_quiz_submissions where exam_id=eid and student_id='A')<>'[0,1,2,3]'::jsonb then raise exception 'set not normalized';end if;
perform public.core_quiz_submit(eid,'B','Synthetic','{"s":0,"m":[0,1,2]}');
perform public.core_quiz_submit(eid,'C','Synthetic','{"s":0,"m":[0,1,2,3,4]}');
if exists(select 1 from public.core_quiz_submissions where exam_id=eid and student_id in ('B','C') and score<>50) then raise exception 'partial answer scored';end if;
update public.core_quiz_exams set closes_at=clock_timestamp()-interval '1 millisecond' where id=eid;
begin
perform public.core_quiz_submit(eid,'D','Synthetic','{"s":0,"m":[0,1,2,3]}');
raise exception 'late submit accepted';
exception when others then if sqlerrm<>'EXAM_CLOSED' then raise;end if;end;
end $$;
rollback;
select 'passed multi validation, exact-set grading, normalization, cutoff' verification;
-- Database clock and row lock prevent immediate opening from bypassing cutoff.
create function public.core_quiz_open_now(p_exam_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare e public.core_quiz_exams%rowtype; t timestamptz;
begin
  select * into e from public.core_quiz_exams where id=p_exam_id for update;
  t := clock_timestamp();
  if not found or e.opens_at is null or e.closes_at is null or t >= e.closes_at
    or (t at time zone 'Asia/Taipei')::date <> (e.closes_at at time zone 'Asia/Taipei')::date then
    raise exception 'OPEN_NOW_UNAVAILABLE';
  end if;
  update public.core_quiz_exams set open=true, opens_at=least(e.opens_at,t) where id=p_exam_id;
  return true;
end;
$$;
revoke all on function public.core_quiz_open_now(text) from public, anon, authenticated;
grant execute on function public.core_quiz_open_now(text) to service_role;

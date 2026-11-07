-- Concurrent staff saving safeguards for the existing shared JSONB school record.
-- The client retries compare-and-swap conflicts and merges independent records.
-- This migration adds database-side duplicate protection for simultaneous writes.

create or replace function public.save_school_state_shared_cas(
  p_id text,
  p_data jsonb,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved_at timestamptz;
  changed integer;
begin
  -- Admission numbers are unique across learners, including concurrent inserts.
  if exists (
    with incoming_learners as (
      select learner_json->>'id' as learner_id,
             upper(trim(learner_json->>'adm')) as admission_no,
             exists (
               select 1 from jsonb_array_elements(
                 coalesce((select data->'learners' from public.school_state_shared where id=p_id),'[]'::jsonb)
               ) old_rows(old_learner)
               where old_rows.old_learner->>'id'=learner_json->>'id'
             ) as existed_before
      from jsonb_array_elements(coalesce(p_data->'learners','[]'::jsonb)) rows(learner_json)
      where nullif(trim(learner_json->>'adm'),'') is not null
    )
    select 1 from incoming_learners group by admission_no
    having count(*)>1 and bool_or(not existed_before)
  ) then
    raise exception using errcode='23505', message='Duplicate learner admission number';
  end if;

  -- Each learner may have one mark per exam and subject.
  if exists (
    with incoming_marks as (
      select mark_json->>'id' as mark_id,
             mark_json->>'learner' as learner_id,
             mark_json->>'exam' as exam_id,
             lower(trim(mark_json->>'subject')) as subject_name,
             exists (
               select 1 from jsonb_array_elements(
                 coalesce((select data->'marks' from public.school_state_shared where id=p_id),'[]'::jsonb)
               ) old_rows(old_mark)
               where old_rows.old_mark->>'id'=mark_json->>'id'
             ) as existed_before
      from jsonb_array_elements(coalesce(p_data->'marks','[]'::jsonb)) rows(mark_json)
      where nullif(mark_json->>'learner','') is not null
        and nullif(mark_json->>'exam','') is not null
        and nullif(trim(mark_json->>'subject'),'') is not null
    )
    select 1 from incoming_marks
    group by learner_id,exam_id,subject_name
    having count(*)>1 and bool_or(not existed_before)
  ) then
    raise exception using errcode='23505', message='Duplicate mark for learner, exam and subject';
  end if;

  -- Keep receipt uniqueness enforced by the existing payment workflow.
  if exists (
    with incoming_payments as (
      select payment_json->>'id' as payment_id,
             lower(trim(payment_json->>'receipt')) as receipt,
             exists (
               select 1 from jsonb_array_elements(
                 coalesce((select data->'payments' from public.school_state_shared where id=p_id),'[]'::jsonb)
               ) old_rows(old_payment)
               where old_rows.old_payment->>'id'=payment_json->>'id'
             ) as existed_before
      from jsonb_array_elements(coalesce(p_data->'payments','[]'::jsonb)) rows(payment_json)
      where nullif(trim(payment_json->>'receipt'),'') is not null
    )
    select 1 from incoming_payments group by receipt
    having count(*)>1 and bool_or(not existed_before)
  ) then
    raise exception using errcode='23505', message='Duplicate fee receipt/reference number';
  end if;

  if p_expected_updated_at is null then
    insert into public.school_state_shared(id,data,updated_at)
    values(p_id,p_data,clock_timestamp())
    on conflict(id) do nothing;
    get diagnostics changed=row_count;
    if changed=0 then return null; end if;
    select updated_at into saved_at from public.school_state_shared where id=p_id;
    return saved_at;
  end if;

  update public.school_state_shared
     set data=p_data,updated_at=clock_timestamp()
   where id=p_id and updated_at=p_expected_updated_at
  returning updated_at into saved_at;
  return saved_at;
end;
$$;

grant execute on function public.save_school_state_shared_cas(text,jsonb,timestamptz) to authenticated;

-- High-concurrency patch saves for Kapnanda.
-- Each browser sends only changed records; this function merges them inside one
-- short database transaction instead of replacing the entire shared JSONB row.
-- PostgreSQL serializes only the brief row update, not the teachers' editing work.

create or replace function public.apply_school_state_patch(
  p_id text,
  p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_data jsonb;
  next_data jsonb;
  item record;
  row_key text;
  incoming jsonb;
  removed_ids jsonb;
  existing_rows jsonb;
  merged_rows jsonb;
  obj_key text;
  obj_change jsonb;
  field_key text;
begin
  if auth.uid() is null or public.current_school_role() not in ('admin','headteacher','teacher','bursar') then
    raise exception using errcode='42501', message='Active school staff access is required';
  end if;
  if p_id <> 'KAPNANDA' then
    raise exception using errcode='22023', message='Invalid school record';
  end if;
  if jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode='22023', message='Invalid change set';
  end if;

  select data into current_data
    from public.school_state_shared
   where id=p_id
   for update;
  if current_data is null then
    raise exception using errcode='P0002', message='School shared record not found';
  end if;
  next_data := current_data;

  -- Apply deletions first, then upserts. Marks are uniquely identified by
  -- learner + assessment + subject, even if two clients generated different IDs.
  for row_key in select jsonb_object_keys(coalesce(p_patch->'deletes','{}'::jsonb))
  loop
    if row_key not in ('learners','teachers','teacherLoads','payments','marks','attendance','timetable','exams','audit','academicPeriods','questionPapers','capitationTransactions','bomBudgets','mealRecords','alumni','certificates','notificationLog') then
      raise exception using errcode='22023', message='Unsupported record collection';
    end if;
    removed_ids := coalesce(p_patch->'deletes'->row_key,'[]'::jsonb);
    select coalesce(jsonb_agg(r.value order by r.ordinality),'[]'::jsonb)
      into merged_rows
      from jsonb_array_elements(coalesce(next_data->row_key,'[]'::jsonb)) with ordinality r(value,ordinality)
     where not exists (
       select 1 from jsonb_array_elements_text(removed_ids) d(id)
       where d.id = r.value->>'id'
     );
    next_data := jsonb_set(next_data,array[row_key],merged_rows,true);
  end loop;

  for row_key in select jsonb_object_keys(coalesce(p_patch->'upserts','{}'::jsonb))
  loop
    if row_key not in ('learners','teachers','teacherLoads','payments','marks','attendance','timetable','exams','audit','academicPeriods','questionPapers','capitationTransactions','bomBudgets','mealRecords','alumni','certificates','notificationLog') then
      raise exception using errcode='22023', message='Unsupported record collection';
    end if;
    incoming := coalesce(p_patch->'upserts'->row_key,'[]'::jsonb);
    if jsonb_typeof(incoming) <> 'array' then
      raise exception using errcode='22023', message='Record changes must be arrays';
    end if;

    if row_key='learners' then
      -- Enforce admission-number uniqueness for newly inserted/changed learners.
      if exists (
        select 1
          from jsonb_array_elements(incoming) n(value)
          join jsonb_array_elements(coalesce(next_data->'learners','[]'::jsonb)) prior_row(value)
            on upper(trim(prior_row.value->>'adm'))=upper(trim(n.value->>'adm'))
           and prior_row.value->>'id' <> n.value->>'id'
      ) or exists (
        select 1
          from jsonb_array_elements(incoming) n(value)
         where nullif(trim(n.value->>'adm'),'') is not null
         group by upper(trim(n.value->>'adm'))
        having count(*) > 1
      ) then
        raise exception using errcode='23505', message='Admission number already exists';
      end if;
    elsif row_key='payments' then
      if exists (
        select 1
          from jsonb_array_elements(incoming) n(value)
          join jsonb_array_elements(coalesce(next_data->'payments','[]'::jsonb)) prior_payment(value)
            on lower(trim(prior_payment.value->>'receipt'))=lower(trim(n.value->>'receipt'))
           and prior_payment.value->>'id' <> n.value->>'id'
         where nullif(trim(n.value->>'receipt'),'') is not null
      ) or exists (
        select 1 from jsonb_array_elements(incoming) n(value)
         where nullif(trim(n.value->>'receipt'),'') is not null
         group by lower(trim(n.value->>'receipt'))
        having count(*) > 1
      ) then
        raise exception using errcode='23505', message='Duplicate fee receipt/reference number';
      end if;
    end if;

    select coalesce(jsonb_agg(r.value order by r.ordinality),'[]'::jsonb)
      into existing_rows
      from jsonb_array_elements(coalesce(next_data->row_key,'[]'::jsonb)) with ordinality r(value,ordinality)
     where not exists (
       select 1 from jsonb_array_elements(incoming) n(value)
        where n.value->>'id'=r.value->>'id'
           or (row_key='marks'
               and n.value->>'learner'=r.value->>'learner'
               and n.value->>'exam'=r.value->>'exam'
               and n.value->>'subject'=r.value->>'subject')
     );
    merged_rows := existing_rows || incoming;
    next_data := jsonb_set(next_data,array[row_key],merged_rows,true);
  end loop;

  -- Merge changed object properties, preserving concurrent changes to other keys.
  for obj_key in select jsonb_object_keys(coalesce(p_patch->'objects','{}'::jsonb))
  loop
    if obj_key not in ('settings','fees','subjectConfigs','timetableMeta') then
      raise exception using errcode='22023', message='Unsupported school settings object';
    end if;
    obj_change := p_patch->'objects'->obj_key;
    if obj_change ? 'replace' then
      next_data := jsonb_set(next_data,array[obj_key],obj_change->'replace',true);
    else
      if jsonb_typeof(next_data->obj_key) <> 'object' or next_data->obj_key is null then
        next_data := jsonb_set(next_data,array[obj_key],'{}'::jsonb,true);
      end if;
      for field_key in select jsonb_array_elements_text(coalesce(obj_change->'remove','[]'::jsonb))
      loop
        next_data := next_data #- array[obj_key,field_key];
      end loop;
      for item in select key,value from jsonb_each(coalesce(obj_change->'set','{}'::jsonb))
      loop
        next_data := jsonb_set(next_data,array[obj_key,item.key],item.value,true);
      end loop;
    end if;
  end loop;

  update public.school_state_shared
     set data=next_data, updated_at=clock_timestamp()
   where id=p_id;

  return jsonb_build_object(
    'data',next_data,
    'updated_at',(select updated_at from public.school_state_shared where id=p_id)
  );
end;
$$;

revoke all on function public.apply_school_state_patch(text,jsonb) from public;
grant execute on function public.apply_school_state_patch(text,jsonb) to authenticated;

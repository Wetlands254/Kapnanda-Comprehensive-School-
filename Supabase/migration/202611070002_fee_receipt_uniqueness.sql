-- Atomic duplicate receipt guard for the existing shared-state save RPC.
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
  -- Reject duplicate receipt references atomically, including simultaneous
  -- staff submissions. Historical duplicates already in the row do not block
  -- unrelated saves; the duplicate group must include a newly added payment ID.
  if exists (
    with incoming_payments as (
      select
        payment_json->>'id' as payment_id,
        lower(trim(payment_json->>'receipt')) as receipt,
        exists (
          select 1
          from jsonb_array_elements(
            coalesce((select data->'payments' from public.school_state_shared where id = p_id), '[]'::jsonb)
          ) as old_rows(old_payment)
          where old_rows.old_payment->>'id' = payment_json->>'id'
        ) as existed_before
      from jsonb_array_elements(coalesce(p_data->'payments', '[]'::jsonb)) as incoming_rows(payment_json)
      where nullif(trim(payment_json->>'receipt'), '') is not null
    )
    select 1
    from incoming_payments
    group by receipt
    having count(*) > 1 and bool_or(not existed_before)
  ) then
    raise exception using errcode = '23505', message = 'Duplicate fee receipt/reference number';
  end if;
  if p_expected_updated_at is null then
    insert into public.school_state_shared(id, data, updated_at)
    values (p_id, p_data, clock_timestamp())
    on conflict (id) do nothing;
    get diagnostics changed = row_count;
    if changed = 0 then return null; end if;
    select updated_at into saved_at from public.school_state_shared where id = p_id;
    return saved_at;
  end if;

  update public.school_state_shared
     set data = p_data,
         updated_at = clock_timestamp()
   where id = p_id
     and updated_at = p_expected_updated_at
  returning updated_at into saved_at;

  return saved_at;
end;
$$;

grant execute on function public.save_school_state_shared_cas(text, jsonb, timestamptz) to authenticated;

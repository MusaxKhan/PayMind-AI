-- ============================================================================
-- Sitara Traders — migration 010
-- Run this AFTER 009_loan_deletion.sql (check your Supabase migration history
-- first, same caveat as 006/008/009).
--
-- WHY
--   snapshot_contract_investors() used to freeze "whoever is in the active
--   phase RIGHT NOW". That is only correct when a contract is created on the
--   day it starts. For a back-dated contract (start_date in the past) it
--   wrongly included investors who joined AFTER the contract's start date, so
--   they shared in profit from a contract that began before they invested.
--
--   Rule enforced from now on: a contract's profit pool is the investors (and
--   amounts) that were in the phase ON the contract's start_date — or, for a
--   contract that started before the phase's capital was first recorded, the
--   phase's original cohort (see contract_pool_as_of_date).
--
-- HOW "AS OF" IS DETERMINED
--   investor_phase_investments has no date column, but every investment and
--   every later top-up/reduction is mirrored in cash_ledger as an
--   entry_type = 'investment' row linked by investment_id, with an entry_date.
--   So the amount an investor had in the phase on date D is the sum of that
--   investment's ledger rows with entry_date <= D.
--     * If every ledger row for the investment is on/before D (the normal,
--       non-back-dated case) the current investment_amount is used as-is, so
--       contracts created today behave exactly as before.
--     * If the investment has no ledger rows at all (legacy data) its
--       created_at date is used instead.
--
-- CONTENTS
--   1. investor_pool_as_of(phase, date)  — the single as-of rule (read-only)
--   2. snapshot_contract_investors(contract, as_of default = start_date)
--   3. repair_contract_investor_snapshot(contract, redistribute) — admin tool
--      to fix contracts that were already created/distributed wrongly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. As-of investor pool
-- ----------------------------------------------------------------------------
create or replace function public.investor_pool_as_of(
  p_phase_id bigint,
  p_as_of date
)
returns table (investor_id bigint, investment_amount numeric)
language sql
stable
as $$
  select
    ipi.investor_id,
    case
      -- Legacy investment with no ledger history: fall back to created_at.
      when not exists (
        select 1 from cash_ledger cl
        where cl.entry_type = 'investment' and cl.investment_id = ipi.id
      ) then
        case when ipi.created_at::date <= p_as_of
             then ipi.investment_amount else 0 end
      -- Nothing changed after the as-of date: current amount is the answer.
      when not exists (
        select 1 from cash_ledger cl
        where cl.entry_type = 'investment' and cl.investment_id = ipi.id
          and cl.entry_date > p_as_of
      ) then ipi.investment_amount
      -- Otherwise: what the ledger says they had on that date (never more
      -- than they have now).
      else least(
        ipi.investment_amount,
        greatest(0, (
          select coalesce(sum(cl.amount), 0) from cash_ledger cl
          where cl.entry_type = 'investment' and cl.investment_id = ipi.id
            and cl.entry_date <= p_as_of
        ))
      )
    end::numeric as investment_amount
  from investor_phase_investments ipi
  where ipi.phase_id = p_phase_id;
$$;

grant execute on function public.investor_pool_as_of(bigint, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 1b. Effective as-of date for a contract
--
-- A contract that started BEFORE the phase's capital was first recorded (e.g.
-- an older contract entered after a new phase was opened) has no investors on
-- its literal start date. For those the pool is the phase's original cohort:
-- as-of = the later of the contract's start date and the phase's first
-- investment date. Investors who join after that still never share in it.
-- ----------------------------------------------------------------------------
create or replace function public.contract_pool_as_of_date(
  p_phase_id bigint,
  p_start_date date
)
returns date
language sql
stable
as $$
  select greatest(
    p_start_date,
    coalesce((
      select min(coalesce(
        (select min(cl.entry_date) from cash_ledger cl
         where cl.entry_type = 'investment' and cl.investment_id = ipi.id),
        ipi.created_at::date))
      from investor_phase_investments ipi
      where ipi.phase_id = p_phase_id
    ), p_start_date)
  );
$$;

grant execute on function public.contract_pool_as_of_date(bigint, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. snapshot_contract_investors — now as-of the contract's start date
-- ----------------------------------------------------------------------------
drop function if exists public.snapshot_contract_investors(bigint);

create or replace function public.snapshot_contract_investors(
  p_contract_id bigint,
  p_as_of date default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contract contracts%rowtype;
  v_phase_id bigint;
  v_as_of date;
  v_total_investment numeric(14,2);
  v_existing_count integer;
begin
  select * into v_contract from contracts where id = p_contract_id for update;

  if v_contract.id is null then
    raise exception 'Contract % not found', p_contract_id;
  end if;

  select count(*) into v_existing_count
  from contract_investor_snapshots
  where contract_id = p_contract_id;

  if v_existing_count > 0 then
    -- Already snapshotted — never overwrite an existing snapshot.
    -- (Use repair_contract_investor_snapshot() to deliberately redo one.)
    return;
  end if;

  if v_contract.phase_id is not null then
    v_phase_id := v_contract.phase_id;
  else
    select id into v_phase_id
    from business_phases
    where status = 'ACTIVE'
    order by start_date desc
    limit 1;
  end if;

  if v_phase_id is null then
    raise exception 'No active business phase exists — create a business phase with investor investments before creating a contract.';
  end if;

  v_as_of := contract_pool_as_of_date(v_phase_id, coalesce(p_as_of, v_contract.start_date));

  select coalesce(sum(investment_amount), 0) into v_total_investment
  from investor_pool_as_of(v_phase_id, v_as_of);

  if v_total_investment <= 0 then
    raise exception 'No investor capital was in the business phase on %. A contract starting on that date has no investors to fund it — record the investors'' investment dates correctly (or choose a later start date) before creating this contract.', v_as_of;
  end if;

  insert into contract_investor_snapshots
    (contract_id, phase_id, investor_id, investment_amount, percent_of_pool)
  select
    p_contract_id,
    v_phase_id,
    pool.investor_id,
    pool.investment_amount,
    round(pool.investment_amount / v_total_investment * 100, 6)
  from investor_pool_as_of(v_phase_id, v_as_of) pool
  where pool.investment_amount > 0;

  update contracts
  set phase_id = v_phase_id
  where id = p_contract_id;
end;
$$;

grant execute on function public.snapshot_contract_investors(bigint, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. repair_contract_investor_snapshot — fix an already-wrong contract
--
-- Rebuilds the contract's snapshot as of its start_date.
--   * Not yet distributed: just swaps the snapshot.
--   * Already distributed: requires p_redistribute = true. Deletes that
--     contract's profit_distributions, resets profit_distributed, re-runs
--     distribute_contract_profit() against the corrected snapshot, then
--     verifies no investor's available balance went negative (i.e. nobody
--     withdrew money that now turns out not to be theirs). If any would,
--     the whole thing is rolled back with an error naming the investor.
-- Admin only. Everything happens in one transaction.
-- ----------------------------------------------------------------------------
create or replace function public.repair_contract_investor_snapshot(
  p_contract_id bigint,
  p_redistribute boolean default false
)
returns table (investor_id bigint, investment_amount numeric, percent_of_pool numeric, profit_amount numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contract contracts%rowtype;
  v_total numeric(14,2);
  v_as_of date;
  v_bad record;
begin
  if not is_admin() then
    raise exception 'Repairing a contract snapshot requires admin privileges.';
  end if;

  select * into v_contract from contracts where id = p_contract_id for update;
  if v_contract.id is null then
    raise exception 'Contract % not found', p_contract_id;
  end if;
  if v_contract.phase_id is null then
    raise exception 'Contract % has no phase pinned — nothing to rebuild from.', p_contract_id;
  end if;

  if v_contract.profit_distributed and not p_redistribute then
    raise exception 'Contract % has already distributed its profit. Re-run with p_redistribute = true to reverse and redo the distribution.', p_contract_id;
  end if;

  v_as_of := contract_pool_as_of_date(v_contract.phase_id, v_contract.start_date);

  select coalesce(sum(p.investment_amount), 0) into v_total
  from investor_pool_as_of(v_contract.phase_id, v_as_of) p;

  if v_total <= 0 then
    raise exception 'No investor capital was in phase % on %.', v_contract.phase_id, v_as_of;
  end if;

  delete from contract_investor_snapshots where contract_id = p_contract_id;

  insert into contract_investor_snapshots
    (contract_id, phase_id, investor_id, investment_amount, percent_of_pool)
  select p_contract_id, v_contract.phase_id, p.investor_id, p.investment_amount,
         round(p.investment_amount / v_total * 100, 6)
  from investor_pool_as_of(v_contract.phase_id, v_as_of) p
  where p.investment_amount > 0;

  if v_contract.profit_distributed then
    delete from profit_distributions where contract_id = p_contract_id;
    update contracts
    set profit_distributed = false, profit_distributed_at = null
    where id = p_contract_id;

    perform distribute_contract_profit(p_contract_id);

    -- Anyone whose balance is now negative already withdrew money that
    -- belongs to someone else after the correction.
    select inv.id as investor_id, investor_available_balance(inv.id) as bal
    into v_bad
    from investors inv
    where investor_available_balance(inv.id) < 0
    limit 1;

    if found then
      raise exception 'Correcting contract % would leave investor % with a negative available balance (%). They have already withdrawn more than they are now entitled to — settle that first. Nothing was changed.',
        p_contract_id, v_bad.investor_id, v_bad.bal;
    end if;
  end if;

  return query
  select s.investor_id, s.investment_amount, s.percent_of_pool,
         (select pd.profit_amount from profit_distributions pd
          where pd.contract_id = p_contract_id and pd.investor_id = s.investor_id
          limit 1)
  from contract_investor_snapshots s
  where s.contract_id = p_contract_id
  order by s.investor_id;
end;
$$;

revoke all on function public.repair_contract_investor_snapshot(bigint, boolean) from public, anon;
grant execute on function public.repair_contract_investor_snapshot(bigint, boolean) to authenticated;

-- ============================================================================
-- End of migration 010.
-- ============================================================================

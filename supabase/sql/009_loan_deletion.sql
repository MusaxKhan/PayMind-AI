-- ============================================================================
-- Sitara Traders — follow-up migration (009)
-- Run this AFTER 008_business_expense_edit.sql (and whatever migration your
-- live database is actually on beyond that — check your Supabase migration
-- history before running, same caveat as 006 and 008).
--
-- Adds loan deletion:
--   1. loan_deletion_log — an append-only audit table, same idea as
--      contract_deletion_log (migration 006): every delete writes a full
--      JSON snapshot of the loan + every cash_ledger row tied to it
--      (the original loan inflow AND every repayment made against it)
--      BEFORE anything is removed, so a mistaken delete is always
--      reconstructable even though the delete itself is a hard delete.
--   2. delete_loan(p_loan_id, p_reverse_cash) — one atomic, row-locked
--      transaction (same pattern as delete_contract) that removes a loan
--      and decides what happens to cash-in-hand based on p_reverse_cash:
--        - true  ("full undo"): delete every cash_ledger row tied to
--          this loan — the original 'loan' inflow AND every
--          'loan_repayment' outflow made against it. Cash-in-hand ends
--          up exactly where it would be if this loan had never
--          happened: the money that came in from the lender is removed,
--          and so is every repayment that went back out. Refused if
--          that would take cash-in-hand below zero (the inflow may
--          already be spent elsewhere).
--        - false ("keep cash history"): all of this loan's cash_ledger
--          rows are kept (so cash-in-hand and historical totals are
--          unaffected) but detached from the loan (loan_id set to null,
--          since the loan row is about to stop existing) and annotated.
--   A loan with no repayments has nothing to "keep" either way — the
--   only meaningful choice is whether the original inflow is reversed,
--   same as an unpaid contract only has its purchase entry to decide on.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Audit log
-- ----------------------------------------------------------------------------
create table if not exists loan_deletion_log (
  id bigint generated always as identity primary key,

  loan_id bigint not null,
  lender_name text not null,

  cash_reversed boolean not null,
  deleted_by uuid references user_profiles(id) on delete set null,
  deleted_by_email text,

  -- Full pre-delete snapshot: loan row + every cash_ledger row tied to
  -- it (the original inflow, plus every repayment), as jsonb.
  snapshot jsonb not null,

  created_at timestamptz default now()
);

alter table loan_deletion_log enable row level security;

drop policy if exists staff_read on loan_deletion_log;
create policy staff_read on loan_deletion_log
  for select using (is_authenticated_staff());

-- Only ever written by delete_loan() below, which runs as security
-- definer, so no direct-insert policy is needed for staff.

-- ----------------------------------------------------------------------------
-- 2. Atomic loan deletion
-- ----------------------------------------------------------------------------
create or replace function delete_loan(
  p_loan_id bigint,
  p_reverse_cash boolean
)
returns loan_deletion_log
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans%rowtype;
  v_actor_id uuid;
  v_actor_email text;
  v_snapshot jsonb;
  v_log_row loan_deletion_log%rowtype;
  v_ledger_net numeric(14,2);
  v_balance_after numeric(14,2);
begin
  if not is_admin() then
    raise exception 'Deleting a loan requires admin privileges.';
  end if;

  v_actor_id := auth.uid();
  select email into v_actor_email from user_profiles where id = v_actor_id;

  -- Lock the loan row for the duration of this transaction so a
  -- concurrent repayment can't race with the delete.
  select * into v_loan from loans where id = p_loan_id for update;

  if v_loan.id is null then
    raise exception 'Loan % not found', p_loan_id;
  end if;

  -- Build the full pre-delete snapshot before touching anything.
  select jsonb_build_object(
    'loan', to_jsonb(v_loan),
    'cash_ledger', coalesce(
      (select jsonb_agg(to_jsonb(cl)) from cash_ledger cl where cl.loan_id = p_loan_id),
      '[]'::jsonb
    )
  ) into v_snapshot;

  if p_reverse_cash then

    -- Net effect of every ledger row tied to this loan: the +amount
    -- inflow plus every -repayment outflow. For a fully repaid loan
    -- this nets to zero (amount - amount_repaid = 0), so reversing a
    -- fully repaid loan never touches cash-in-hand. For an
    -- active/partially repaid loan it equals the outstanding balance,
    -- and removing it takes that much back out of cash-in-hand — which
    -- only fails if that inflow has since been spent elsewhere.
    select coalesce(sum(amount), 0) into v_ledger_net
    from cash_ledger where loan_id = p_loan_id;

    v_balance_after := current_cash_in_hand() - v_ledger_net;

    if v_balance_after < 0 then
      raise exception
        'Reversing this loan would take cash in hand below zero (resulting balance: %). The % this loan brought in has already been spent elsewhere — choose "keep cash history" instead, or settle enough cash back first.',
        v_balance_after, v_loan.amount;
    end if;

    delete from cash_ledger where loan_id = p_loan_id;
  else
    update cash_ledger
    set loan_id = null,
        description = trim(both ' ' from coalesce(description, '') ||
          ' [loan from ' || v_loan.lender_name || ' deleted — cash history preserved]')
    where loan_id = p_loan_id;
  end if;

  delete from loans where id = p_loan_id;

  insert into loan_deletion_log (
    loan_id, lender_name,
    cash_reversed, deleted_by, deleted_by_email, snapshot
  )
  values (
    p_loan_id, v_loan.lender_name,
    p_reverse_cash, v_actor_id, v_actor_email, v_snapshot
  )
  returning * into v_log_row;

  return v_log_row;
end;
$$;

-- ============================================================================
-- End of migration 009.
-- ============================================================================
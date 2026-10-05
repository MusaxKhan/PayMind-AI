-- ============================================================================
-- Sitara Traders — migration 011: Loans Given (money the business lends out)
-- Run AFTER 010_snapshot_as_of_contract_date.sql.
--
-- A given loan is the mirror image of the existing "Loans" feature (money the
-- business borrows): the business hands out cash and the borrower pays it back
-- in monthly installments (1 installment = lump sum). No interest.
--
-- CASH FLOW (everything flows through cash_ledger, so cash-in-hand, the
-- dashboard, the ledger page and the graphs pick it up automatically):
--   give loan            -> 'loan_given'            : -amount, dated loan_date
--   borrower pays        -> 'loan_given_repayment'  : +amount, dated payment date
-- Giving a loan is refused unless cash in hand covers it (friendly check inside
-- create_given_loan, hard backstop in the enforce_cash_floor trigger).
--
-- Overdue status is NOT stored: it is derived from the installments' due dates
-- at read time, so it can never go stale. Stored status is only
-- ACTIVE / COMPLETED.
--
-- CONTENTS
--   1. given_loans, given_loan_installments, given_loan_payments (+ RLS)
--   2. cash_ledger: new columns + new entry types + cash floor on loan_given
--   3. next_given_loan_code()
--   4. create_given_loan()         atomic: cash check, loan, schedule, ledger
--   5. record_given_loan_payment() atomic: allocate, installments, ledger
--   6. delete_given_loan() + given_loan_deletion_log (admin)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create sequence if not exists given_loan_code_seq start 1;

create table if not exists given_loans (
  id bigint generated always as identity primary key,
  loan_code text not null unique,

  -- Borrower: an existing client OR free text (someone who isn't a client).
  -- borrower_name is always filled (copied from the client when one is chosen)
  -- so the loan still reads correctly if the client is later renamed/removed.
  client_id bigint references clients(id) on delete set null,
  borrower_name text not null,
  borrower_phone text,

  reason text,
  amount numeric(14,2) not null check (amount > 0),
  number_of_installments integer not null check (number_of_installments >= 1),
  amount_per_installment numeric(14,2) not null,
  loan_date date not null,
  expected_end_date date not null,

  amount_repaid numeric(14,2) not null default 0 check (amount_repaid >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED')),

  created_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists given_loan_installments (
  id bigint generated always as identity primary key,
  given_loan_id bigint not null references given_loans(id) on delete cascade,
  installment_number integer not null,
  due_date date not null,
  installment_amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null default 0,
  remaining_amount numeric(14,2) not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PARTIAL', 'PAID')),
  unique (given_loan_id, installment_number)
);

create table if not exists given_loan_payments (
  id bigint generated always as identity primary key,
  given_loan_id bigint not null references given_loans(id) on delete cascade,
  amount_paid numeric(14,2) not null check (amount_paid > 0),
  remaining_balance numeric(14,2) not null,   -- loan balance after this payment
  payment_date date not null,
  payment_method text,
  remarks text,
  created_at timestamptz not null default now()
);

create index if not exists idx_given_loan_installments_loan on given_loan_installments(given_loan_id);
create index if not exists idx_given_loan_installments_due on given_loan_installments(due_date) where status <> 'PAID';
create index if not exists idx_given_loan_payments_loan on given_loan_payments(given_loan_id);

alter table given_loans enable row level security;
alter table given_loan_installments enable row level security;
alter table given_loan_payments enable row level security;

drop policy if exists staff_full_access on given_loans;
create policy staff_full_access on given_loans
  using (is_authenticated_staff()) with check (is_authenticated_staff());
drop policy if exists staff_full_access on given_loan_installments;
create policy staff_full_access on given_loan_installments
  using (is_authenticated_staff()) with check (is_authenticated_staff());
drop policy if exists staff_full_access on given_loan_payments;
create policy staff_full_access on given_loan_payments
  using (is_authenticated_staff()) with check (is_authenticated_staff());

-- ----------------------------------------------------------------------------
-- 2. cash_ledger
-- ----------------------------------------------------------------------------
alter table cash_ledger
  add column if not exists given_loan_id bigint references given_loans(id) on delete set null,
  add column if not exists given_loan_payment_id bigint references given_loan_payments(id) on delete set null;

alter table cash_ledger drop constraint if exists cash_ledger_entry_type_check;
alter table cash_ledger add constraint cash_ledger_entry_type_check check (
  entry_type = any (array[
    'investment', 'loan', 'payment_received', 'purchase', 'withdrawal',
    'loan_repayment', 'business_expense', 'loan_given', 'loan_given_repayment'
  ])
);

create or replace function public.enforce_cash_floor()
returns trigger
language plpgsql
as $$
declare
  v_balance_after numeric(14,2);
begin
  if new.entry_type in ('withdrawal', 'loan_repayment', 'loan_given') then
    select coalesce(sum(amount), 0) + new.amount into v_balance_after
    from cash_ledger;

    if v_balance_after < 0 then
      raise exception
        'This % of % would take cash in hand below zero (resulting balance: %). Rejected.',
        new.entry_type, abs(new.amount), v_balance_after;
    end if;
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Codes: LG-0001, LG-0002, ...
-- ----------------------------------------------------------------------------
create or replace function public.next_given_loan_code()
returns text
language sql
as $$
  select 'LG-' || lpad(nextval('given_loan_code_seq')::text, 4, '0');
$$;

-- ----------------------------------------------------------------------------
-- 4. create_given_loan
-- ----------------------------------------------------------------------------
create or replace function public.create_given_loan(
  p_client_id bigint,
  p_borrower_name text,
  p_borrower_phone text,
  p_reason text,
  p_amount numeric,
  p_number_of_installments integer,
  p_loan_date date
)
returns setof given_loans
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text;
  v_phone text;
  v_per numeric(14,2);
  v_last numeric(14,2);
  v_cash numeric(14,2);
  v_loan given_loans%rowtype;
  i integer;
begin
  if not is_authenticated_staff() then
    raise exception 'Not authorised.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Loan amount must be greater than zero';
  end if;
  if p_number_of_installments is null or p_number_of_installments < 1 or p_number_of_installments > 120 then
    raise exception 'Number of installments must be between 1 and 120';
  end if;
  -- Date check. +1 day tolerance because the app's "today" is the user's local
  -- date (Pakistan is ahead of the server's UTC clock).
  if p_loan_date is null or p_loan_date > current_date + 1 then
    raise exception 'The loan date cannot be in the future.';
  end if;

  if p_client_id is not null then
    select name, phone into v_name, v_phone
    from clients where id = p_client_id and not is_deleted;
    if v_name is null then
      raise exception 'Selected client does not exist or has been deleted.';
    end if;
  else
    v_name := nullif(trim(p_borrower_name), '');
    v_phone := nullif(trim(p_borrower_phone), '');
    if v_name is null then
      raise exception 'Borrower name is required.';
    end if;
  end if;

  -- Cash check. Serialise concurrent cash-out operations on this lock so two
  -- loans can't both pass the check against the same cash.
  perform pg_advisory_xact_lock(hashtext('cash_ledger_outflow'));
  v_cash := current_cash_in_hand();
  if p_amount > v_cash then
    raise exception
      'Not enough cash in hand. This loan is % but cash in hand is only %.',
      p_amount, v_cash;
  end if;

  v_per  := round(p_amount / p_number_of_installments, 2);
  v_last := round(p_amount - v_per * (p_number_of_installments - 1), 2);

  insert into given_loans (
    loan_code, client_id, borrower_name, borrower_phone, reason, amount,
    number_of_installments, amount_per_installment, loan_date,
    expected_end_date, created_by
  )
  values (
    next_given_loan_code(), p_client_id, v_name, v_phone,
    nullif(trim(p_reason), ''), p_amount,
    p_number_of_installments, v_per, p_loan_date,
    (p_loan_date + (p_number_of_installments || ' months')::interval)::date,
    auth.uid()
  )
  returning * into v_loan;

  for i in 1..p_number_of_installments loop
    insert into given_loan_installments (
      given_loan_id, installment_number, due_date,
      installment_amount, paid_amount, remaining_amount, status
    )
    values (
      v_loan.id, i,
      (p_loan_date + (i || ' months')::interval)::date,
      case when i = p_number_of_installments then v_last else v_per end,
      0,
      case when i = p_number_of_installments then v_last else v_per end,
      'PENDING'
    );
  end loop;

  insert into cash_ledger (entry_type, amount, given_loan_id, entry_date, description)
  values ('loan_given', -p_amount, v_loan.id, p_loan_date,
          'Loan given to ' || v_name || ' (' || v_loan.loan_code || ')');

  return next v_loan;
  return;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. record_given_loan_payment
-- ----------------------------------------------------------------------------
create or replace function public.record_given_loan_payment(
  p_given_loan_id bigint,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_remarks text
)
returns setof given_loans
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_loan given_loans%rowtype;
  v_outstanding numeric(14,2);
  v_left numeric(14,2);
  v_apply numeric(14,2);
  v_inst given_loan_installments%rowtype;
  v_new_paid numeric(14,2);
  v_new_rem numeric(14,2);
  v_payment_id bigint;
  v_updated given_loans%rowtype;
begin
  if not is_authenticated_staff() then
    raise exception 'Not authorised.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select * into v_loan from given_loans where id = p_given_loan_id for update;
  if v_loan.id is null then
    raise exception 'Loan % not found', p_given_loan_id;
  end if;
  if v_loan.status = 'COMPLETED' then
    raise exception 'This loan is already fully repaid — no further payments can be recorded.';
  end if;

  -- Date checks.
  if p_payment_date is null then
    raise exception 'Payment date is required.';
  end if;
  if p_payment_date < v_loan.loan_date then
    raise exception 'The payment date (%) cannot be before the loan date (%).', p_payment_date, v_loan.loan_date;
  end if;
  if p_payment_date > current_date + 1 then
    raise exception 'The payment date cannot be in the future.';
  end if;

  v_outstanding := v_loan.amount - v_loan.amount_repaid;
  if p_amount > v_outstanding then
    raise exception 'This payment (%) is more than the % still owed on this loan.', p_amount, v_outstanding;
  end if;

  -- Allocate oldest installment first.
  v_left := p_amount;
  for v_inst in
    select * from given_loan_installments
    where given_loan_id = p_given_loan_id and status <> 'PAID'
    order by installment_number
    for update
  loop
    exit when v_left <= 0;
    v_apply := least(v_left, v_inst.remaining_amount);
    v_new_paid := v_inst.paid_amount + v_apply;
    v_new_rem := v_inst.remaining_amount - v_apply;

    update given_loan_installments
    set paid_amount = v_new_paid,
        remaining_amount = v_new_rem,
        status = case when v_new_rem <= 0 then 'PAID' else 'PARTIAL' end
    where id = v_inst.id;

    v_left := v_left - v_apply;
  end loop;

  update given_loans
  set amount_repaid = amount_repaid + p_amount,
      status = case when amount_repaid + p_amount >= amount then 'COMPLETED' else 'ACTIVE' end,
      updated_at = now()
  where id = p_given_loan_id
  returning * into v_updated;

  insert into given_loan_payments (
    given_loan_id, amount_paid, remaining_balance, payment_date,
    payment_method, remarks
  )
  values (
    p_given_loan_id, p_amount, v_updated.amount - v_updated.amount_repaid,
    p_payment_date, nullif(trim(p_payment_method), ''), nullif(trim(p_remarks), '')
  )
  returning id into v_payment_id;

  insert into cash_ledger (
    entry_type, amount, given_loan_id, given_loan_payment_id, entry_date, description
  )
  values (
    'loan_given_repayment', p_amount, p_given_loan_id, v_payment_id, p_payment_date,
    'Repayment from ' || v_loan.borrower_name || ' (' || v_loan.loan_code || ')'
  );

  return next v_updated;
  return;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Deletion (admin) with audit log
-- ----------------------------------------------------------------------------
create table if not exists given_loan_deletion_log (
  id bigint generated always as identity primary key,
  given_loan_id bigint not null,
  loan_code text not null,
  borrower_name text not null,
  cash_reversed boolean not null,
  deleted_by uuid references user_profiles(id) on delete set null,
  deleted_by_email text,
  snapshot jsonb not null,
  created_at timestamptz default now()
);

alter table given_loan_deletion_log enable row level security;
drop policy if exists staff_read on given_loan_deletion_log;
create policy staff_read on given_loan_deletion_log
  for select using (is_authenticated_staff());

-- p_reverse_cash = true : every ledger row of this loan is removed (the
--   original cash-out AND all repayments), so cash in hand ends up as if the
--   loan never happened. Net effect = +(amount - repaid) >= 0, so this can
--   never push cash below zero.
-- p_reverse_cash = false: ledger rows are kept (history preserved) but
--   detached from the loan.
create or replace function public.delete_given_loan(
  p_given_loan_id bigint,
  p_reverse_cash boolean
)
returns given_loan_deletion_log
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_loan given_loans%rowtype;
  v_actor_id uuid;
  v_actor_email text;
  v_snapshot jsonb;
  v_log given_loan_deletion_log%rowtype;
begin
  if not is_admin() then
    raise exception 'Deleting a loan requires admin privileges.';
  end if;

  v_actor_id := auth.uid();
  select email into v_actor_email from user_profiles where id = v_actor_id;

  select * into v_loan from given_loans where id = p_given_loan_id for update;
  if v_loan.id is null then
    raise exception 'Loan % not found', p_given_loan_id;
  end if;

  select jsonb_build_object(
    'loan', to_jsonb(v_loan),
    'installments', coalesce((select jsonb_agg(to_jsonb(i)) from given_loan_installments i where i.given_loan_id = p_given_loan_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p)) from given_loan_payments p where p.given_loan_id = p_given_loan_id), '[]'::jsonb),
    'cash_ledger', coalesce((select jsonb_agg(to_jsonb(cl)) from cash_ledger cl where cl.given_loan_id = p_given_loan_id), '[]'::jsonb)
  ) into v_snapshot;

  if p_reverse_cash then
    delete from cash_ledger where given_loan_id = p_given_loan_id;
  else
    update cash_ledger
    set given_loan_id = null,
        given_loan_payment_id = null,
        description = trim(both ' ' from coalesce(description, '') ||
          ' [loan ' || v_loan.loan_code || ' deleted — cash history preserved]')
    where given_loan_id = p_given_loan_id;
  end if;

  delete from given_loans where id = p_given_loan_id;  -- installments/payments cascade

  insert into given_loan_deletion_log (
    given_loan_id, loan_code, borrower_name, cash_reversed,
    deleted_by, deleted_by_email, snapshot
  )
  values (
    p_given_loan_id, v_loan.loan_code, v_loan.borrower_name, p_reverse_cash,
    v_actor_id, v_actor_email, v_snapshot
  )
  returning * into v_log;

  return v_log;
end;
$$;

grant execute on function public.create_given_loan(bigint, text, text, text, numeric, integer, date) to authenticated;
grant execute on function public.record_given_loan_payment(bigint, numeric, date, text, text) to authenticated;
grant execute on function public.delete_given_loan(bigint, boolean) to authenticated;
grant execute on function public.next_given_loan_code() to authenticated;

-- ============================================================================
-- End of migration 011.
-- ============================================================================

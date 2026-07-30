-- ============================================================================
-- Sitara Traders — follow-up migration (008)
-- Run this AFTER 007_delete_contract_cash_floor_fix and 006_contract_deletion.sql (and whatever migration your live
-- database is actually on beyond that — check your Supabase migration
-- history before running, same caveat as 006).
--
-- Adds business expense editing:
--   update_business_expense_with_balance_check(...) — mirrors
--   create_business_expense_with_balance_check() (migration 004) but for
--   an existing row: locks the expense row, takes the same
--   'cash_ledger_balance_check' advisory lock the create path uses (so a
--   concurrent create and edit can't both read the same cash-in-hand
--   figure and both pass their checks), re-checks cash-in-hand against
--   the NEW amount, and — if that passes — updates both the
--   business_expenses row and its linked cash_ledger row together, in one
--   transaction. Editing the amount, category, date, title, notes, or
--   receipt reference all go through this one function so the ledger
--   entry never drifts from what's shown on the Expenses page.
--
--   Refuses (raises, writes nothing) if:
--     - the new amount is <= 0 or the title is blank (same as create)
--     - the expense id doesn't exist
--     - its linked cash_ledger row can't be found (refuses to guess
--       which row to update rather than silently corrupting cash-in-hand)
--     - the new amount would take cash-in-hand below zero
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_business_expense_with_balance_check(
  p_expense_id bigint,
  p_title text,
  p_amount numeric,
  p_category text,
  p_expense_date date,
  p_notes text,
  p_receipt_reference text
) RETURNS SETOF public.business_expenses
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  v_expense business_expenses%rowtype;

  v_ledger_id bigint;

  v_old_ledger_amount numeric(14,2);

  v_cash_in_hand numeric(14,2);

  v_balance_after numeric(14,2);

begin

  if p_amount is null or p_amount <= 0 then

    raise exception 'Expense amount must be greater than zero';

  end if;

  if p_title is null or length(trim(p_title)) = 0 then

    raise exception 'Expense title is required';

  end if;

  -- Lock the expense row for the duration of this transaction so a
  -- concurrent edit of the same row can't race with this one.

  select * into v_expense from business_expenses where id = p_expense_id for update;

  if v_expense.id is null then

    raise exception 'Business expense % not found', p_expense_id;

  end if;

  -- Same advisory lock create_business_expense_with_balance_check takes.
  -- Held for the rest of this transaction, so a brand-new expense being
  -- created at the same instant can't read cash-in-hand before this
  -- edit's change is accounted for, or vice versa.

  perform pg_advisory_xact_lock(hashtext('cash_ledger_balance_check'));

  select id, amount into v_ledger_id, v_old_ledger_amount
  from cash_ledger
  where business_expense_id = p_expense_id
    and entry_type = 'business_expense';

  if v_ledger_id is null then

    raise exception
      'No matching cash ledger entry found for expense % — refusing to edit blind. Please reconcile cash_ledger manually.',
      p_expense_id;

  end if;

  -- v_old_ledger_amount is negative (it's a deduction). Current
  -- cash-in-hand already reflects it, so undo it and apply the new
  -- deduction to see what balance this edit would leave behind.

  v_cash_in_hand := current_cash_in_hand();

  v_balance_after := v_cash_in_hand - v_old_ledger_amount - p_amount;

  if v_balance_after < 0 then

    raise exception
      'Setting this expense to Rs. % would take cash in hand below zero (resulting balance: Rs. %). Rejected.',
      p_amount, v_balance_after;

  end if;

  update business_expenses

  set title = trim(p_title),
      amount = p_amount,
      category = p_category,
      expense_date = p_expense_date,
      notes = p_notes,
      receipt_reference = p_receipt_reference,
      updated_at = now()

  where id = p_expense_id

  returning * into v_expense;

  update cash_ledger

  set amount = -p_amount,
      entry_date = p_expense_date,
      description = 'Business expense: ' || trim(p_title)

  where id = v_ledger_id;

  return next v_expense;

end;

$$;

ALTER FUNCTION public.update_business_expense_with_balance_check(p_expense_id bigint, p_title text, p_amount numeric, p_category text, p_expense_date date, p_notes text, p_receipt_reference text) OWNER TO postgres;

GRANT ALL ON FUNCTION public.update_business_expense_with_balance_check(p_expense_id bigint, p_title text, p_amount numeric, p_category text, p_expense_date date, p_notes text, p_receipt_reference text) TO anon;
GRANT ALL ON FUNCTION public.update_business_expense_with_balance_check(p_expense_id bigint, p_title text, p_amount numeric, p_category text, p_expense_date date, p_notes text, p_receipt_reference text) TO authenticated;
GRANT ALL ON FUNCTION public.update_business_expense_with_balance_check(p_expense_id bigint, p_title text, p_amount numeric, p_category text, p_expense_date date, p_notes text, p_receipt_reference text) TO service_role;

-- ============================================================================
-- End of migration 008.
-- ============================================================================
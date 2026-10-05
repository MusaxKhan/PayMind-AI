-- ============================================================================
-- READ-ONLY consistency audit. Safe to run any time in the Supabase SQL
-- editor (it changes nothing). Every query should return ZERO rows; any row
-- returned is a contract/investor whose money does not add up.
-- Run it once BEFORE and once AFTER applying migration 010.
--
-- Needs migration 010 (check 1 uses investor_pool_as_of).
-- ============================================================================

-- 1. Snapshot does not match "who was in the phase on the contract start date"
--    (the back-dating bug: an investor who joined later is in the pool)
with expected as (
  select c.id as contract_id, p.investor_id, p.investment_amount
  from contracts c
  cross join lateral investor_pool_as_of(c.phase_id, contract_pool_as_of_date(c.phase_id, c.start_date)) p
  where c.phase_id is not null and p.investment_amount > 0
)
select coalesce(e.contract_id, s.contract_id) as contract_id,
       c.contract_code,
       coalesce(e.investor_id, s.investor_id) as investor_id,
       e.investment_amount as should_be,
       s.investment_amount as snapshot_has
from expected e
full join contract_investor_snapshots s
  on s.contract_id = e.contract_id and s.investor_id = e.investor_id
join contracts c on c.id = coalesce(e.contract_id, s.contract_id)
where e.investor_id is null            -- in snapshot but shouldn't be
   or s.investor_id is null            -- should be, but missing
   or e.investment_amount <> s.investment_amount;

-- 2. Contract terms: total = purchase + profit; installments sum to total
select c.id, c.contract_code, c.purchase_price, c.profit_amount, c.total_price,
       (select sum(installment_amount) from installments i where i.contract_id = c.id) as installments_sum
from contracts c
where c.total_price <> c.purchase_price + c.profit_amount
   or c.total_price <> (select coalesce(sum(installment_amount), 0) from installments i where i.contract_id = c.id);

-- 3. Payments vs installments vs remaining balance
select c.id, c.contract_code, c.total_price, c.remaining_balance,
       coalesce(p.paid, 0) as payments_sum,
       coalesce(i.paid, 0) as installments_paid_sum,
       coalesce(i.rem, 0)  as installments_remaining_sum
from contracts c
left join (select contract_id, sum(amount_paid) paid from payments group by contract_id) p on p.contract_id = c.id
left join (select contract_id, sum(paid_amount) paid, sum(remaining_amount) rem from installments group by contract_id) i on i.contract_id = c.id
where coalesce(p.paid, 0) <> coalesce(i.paid, 0)
   or c.remaining_balance <> c.total_price - coalesce(p.paid, 0)
   or c.remaining_balance <> coalesce(i.rem, 0);

-- 4. Individual installments: remaining = amount - paid, status matches
select contract_id, installment_number, installment_amount, paid_amount, remaining_amount, status
from installments
where remaining_amount <> installment_amount - paid_amount
   or (status = 'PAID'    and remaining_amount <> 0)
   or (status = 'PENDING' and paid_amount <> 0)
   or (status = 'PARTIAL' and (paid_amount = 0 or remaining_amount = 0));

-- 5. Contract status vs installments (COMPLETED iff every installment PAID)
select c.id, c.contract_code, c.status,
       bool_and(i.status = 'PAID') as all_paid
from contracts c join installments i on i.contract_id = c.id
group by c.id, c.contract_code, c.status
having (c.status = 'COMPLETED') <> bool_and(i.status = 'PAID');

-- 6. Cash ledger: every payment has exactly one matching ledger row
select p.id as payment_id, p.contract_id, p.amount_paid,
       count(cl.id) as ledger_rows, coalesce(sum(cl.amount), 0) as ledger_sum
from payments p
left join cash_ledger cl on cl.payment_id = p.id and cl.entry_type = 'payment_received'
group by p.id, p.contract_id, p.amount_paid
having count(cl.id) <> 1 or coalesce(sum(cl.amount), 0) <> p.amount_paid;

-- 7. Cash ledger: every contract has exactly one purchase row = -purchase_price
select c.id, c.contract_code, c.purchase_price,
       count(cl.id) as ledger_rows, coalesce(sum(cl.amount), 0) as ledger_sum
from contracts c
left join cash_ledger cl on cl.contract_id = c.id and cl.entry_type = 'purchase'
group by c.id, c.contract_code, c.purchase_price
having count(cl.id) <> 1 or coalesce(sum(cl.amount), 0) <> -c.purchase_price;

-- 8. Profit distribution: flag matches rows; rows match snapshot; sum = profit
select c.id, c.contract_code, c.profit_distributed, c.profit_amount,
       count(pd.id) as dist_rows, coalesce(sum(pd.profit_amount), 0) as dist_sum
from contracts c
left join profit_distributions pd on pd.contract_id = c.id
group by c.id, c.contract_code, c.profit_distributed, c.profit_amount
having (c.profit_distributed and (count(pd.id) = 0 or coalesce(sum(pd.profit_amount), 0) <> c.profit_amount))
    or (not c.profit_distributed and count(pd.id) > 0);

select pd.contract_id, pd.investor_id, 'distributed to investor not in snapshot' as problem
from profit_distributions pd
left join contract_investor_snapshots s on s.contract_id = pd.contract_id and s.investor_id = pd.investor_id
where s.id is null
union all
select s.contract_id, s.investor_id, 'in snapshot but got no distribution'
from contract_investor_snapshots s
join contracts c on c.id = s.contract_id and c.profit_distributed
left join profit_distributions pd on pd.contract_id = s.contract_id and pd.investor_id = s.investor_id
where pd.id is null;

-- 9. Snapshot percentages add up to 100 (within rounding)
select contract_id, sum(percent_of_pool) as pct_total
from contract_investor_snapshots
group by contract_id
having abs(sum(percent_of_pool) - 100) > 0.01;

-- 10. Contracts with no snapshot at all
select c.id, c.contract_code from contracts c
where not exists (select 1 from contract_investor_snapshots s where s.contract_id = c.id);

-- 11. Investors whose available balance (distributions - withdrawals) is negative
select i.id, i.name, investor_available_balance(i.id) as balance
from investors i
where investor_available_balance(i.id) < 0;

-- 12. Cash in hand total (for eyeballing against what you expect)
select current_cash_in_hand() as cash_in_hand;

-- Repair schema gaps detected in the isolated optics-staging environment.
-- Keep changes additive and safe for existing branch inventory.
alter table public.branch_products
  add column if not exists low_stock_threshold integer not null default 2
  check (low_stock_threshold >= 0);

-- Restore the single brand-level central cash account if a previous setup missed it.
insert into public.cash_accounts(branch_id,name,account_type,payment_method,opening_balance,is_central,active)
select null,'الخزنة المركزية','cash','cash',0,true,true
where not exists (select 1 from public.cash_accounts where is_central = true);

create unique index if not exists cash_accounts_one_central_idx
  on public.cash_accounts(is_central) where is_central;

-- Returns are accessed through trusted server-side RPCs; block direct client table access.
alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
revoke all on public.sale_returns from public, anon, authenticated;
revoke all on public.sale_return_items from public, anon, authenticated;
grant all on public.sale_returns to service_role;
grant all on public.sale_return_items to service_role;

-- Record and preserve the production hardening of sale-return tables.
-- These tables are accessed only through authenticated server routes using service_role.
alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
revoke all privileges on table public.sale_returns, public.sale_return_items from public, anon, authenticated;
grant all privileges on table public.sale_returns, public.sale_return_items to service_role;
revoke all on function public.process_sale_return(uuid,jsonb,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.process_sale_return(uuid,jsonb,uuid,text,uuid,uuid) to service_role;

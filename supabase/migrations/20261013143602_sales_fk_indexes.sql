create index if not exists customers_created_by_idx on public.customers(created_by) where created_by is not null;
create index if not exists sales_created_by_idx on public.sales(created_by) where created_by is not null;
create index if not exists sale_payments_received_by_idx on public.sale_payments(received_by) where received_by is not null;

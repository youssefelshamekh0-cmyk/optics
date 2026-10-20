-- Automatically post supplier liabilities for general purchases and received lens supplies.
alter table public.supplier_ledger_entries
  add column if not exists source_type text not null default 'manual',
  add column if not exists lens_supply_id uuid references public.lens_supplies(id) on delete restrict;

create unique index if not exists supplier_ledger_purchase_entry_unique
  on public.supplier_ledger_entries(purchase_id, entry_type) where purchase_id is not null;
create unique index if not exists supplier_ledger_lens_supply_unique
  on public.supplier_ledger_entries(lens_supply_id) where lens_supply_id is not null;

create or replace function public.record_purchase_supplier_ledger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.supplier_ledger_entries
    (supplier_id, branch_id, entry_type, source_type, amount, direction, purchase_id, entry_date, description, created_by)
  values
    (new.supplier_id, new.branch_id, 'purchase', 'purchase', new.total_cost, 'debit', new.id,
     coalesce(new.purchased_at::date, current_date), 'فاتورة مشتريات ' || coalesce(new.invoice_number, ''), new.created_by)
  on conflict (purchase_id, entry_type) where purchase_id is not null do nothing;
  if coalesce(new.amount_paid, 0) > 0 then
    insert into public.supplier_ledger_entries
      (supplier_id, branch_id, entry_type, source_type, amount, direction, purchase_id, entry_date, description, created_by)
    values
      (new.supplier_id, new.branch_id, 'payment', 'purchase_payment', new.amount_paid, 'credit', new.id,
       coalesce(new.purchased_at::date, current_date), 'دفعة مقدمة لفاتورة مشتريات ' || coalesce(new.invoice_number, ''), new.created_by)
    on conflict (purchase_id, entry_type) where purchase_id is not null do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists purchases_supplier_ledger_after_insert on public.purchases;
create trigger purchases_supplier_ledger_after_insert after insert on public.purchases
for each row execute function public.record_purchase_supplier_ledger();

create or replace function public.record_lens_supply_supplier_ledger()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.supplier_ledger_entries
    (supplier_id, branch_id, entry_type, source_type, amount, direction, lens_supply_id, entry_date, description, created_by)
  values
    (new.supplier_id, new.branch_id, 'purchase', 'lens_purchase', new.total_cost, 'debit', new.id,
     coalesce(new.received_at::date, new.created_at::date, current_date), 'توريد عدسات ' || coalesce(new.invoice_number, ''), new.created_by)
  on conflict (lens_supply_id) where lens_supply_id is not null do nothing;
  return new;
end;
$$;
drop trigger if exists lens_supplies_supplier_ledger_after_insert on public.lens_supplies;
create trigger lens_supplies_supplier_ledger_after_insert after insert on public.lens_supplies
for each row execute function public.record_lens_supply_supplier_ledger();

insert into public.supplier_ledger_entries
  (supplier_id, branch_id, entry_type, source_type, amount, direction, purchase_id, entry_date, description, created_by)
select p.supplier_id, p.branch_id, 'purchase', 'purchase', p.total_cost, 'debit', p.id,
       coalesce(p.purchased_at::date, current_date), 'فاتورة مشتريات ' || coalesce(p.invoice_number, ''), p.created_by
from public.purchases p where not exists
  (select 1 from public.supplier_ledger_entries e where e.purchase_id=p.id and e.entry_type='purchase');
insert into public.supplier_ledger_entries
  (supplier_id, branch_id, entry_type, source_type, amount, direction, purchase_id, entry_date, description, created_by)
select p.supplier_id, p.branch_id, 'payment', 'purchase_payment', p.amount_paid, 'credit', p.id,
       coalesce(p.purchased_at::date, current_date), 'دفعة مقدمة لفاتورة مشتريات ' || coalesce(p.invoice_number, ''), p.created_by
from public.purchases p where coalesce(p.amount_paid,0)>0 and not exists
  (select 1 from public.supplier_ledger_entries e where e.purchase_id=p.id and e.entry_type='payment');
insert into public.supplier_ledger_entries
  (supplier_id, branch_id, entry_type, source_type, amount, direction, lens_supply_id, entry_date, description, created_by)
select l.supplier_id, l.branch_id, 'purchase', 'lens_purchase', l.total_cost, 'debit', l.id,
       coalesce(l.received_at::date, l.created_at::date, current_date), 'توريد عدسات ' || coalesce(l.invoice_number, ''), l.created_by
from public.lens_supplies l where not exists
  (select 1 from public.supplier_ledger_entries e where e.lens_supply_id=l.id);

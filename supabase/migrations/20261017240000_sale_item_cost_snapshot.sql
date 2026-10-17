-- Preserve cost of goods at the time each sale line is created.
alter table public.sale_items add column if not exists unit_cost numeric(12,2) not null default 0
  check (unit_cost >= 0);
alter table public.sale_items add column if not exists unit_cost_is_estimated boolean not null default false;

-- Historical rows can only be estimated from today's branch cost; the report marks those rows as estimated.
update public.sale_items si
set unit_cost = bp.cost_price, unit_cost_is_estimated = true
from public.sales s, public.branch_products bp
where si.sale_id=s.id and bp.branch_id=s.branch_id and bp.product_id=si.product_id
  and si.unit_cost=0 and bp.cost_price>0;

create or replace function public.capture_sale_item_unit_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_branch uuid; v_cost numeric(12,2);
begin
  if new.product_id is null then
    new.unit_cost := 0;
    return new;
  end if;
  select branch_id into v_branch from public.sales where id=new.sale_id;
  if not found then raise exception 'sale not found for sale item'; end if;
  select cost_price into v_cost from public.branch_products
   where branch_id=v_branch and product_id=new.product_id;
  if not found then raise exception 'product cost not configured for branch'; end if;
  new.unit_cost := coalesce(v_cost,0);
  return new;
end;
$$;
drop trigger if exists sale_items_capture_unit_cost on public.sale_items;
create trigger sale_items_capture_unit_cost
before insert on public.sale_items
for each row execute function public.capture_sale_item_unit_cost();

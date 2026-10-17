-- Preserve cost of goods at the time each sale line is created.
alter table public.sale_items add column if not exists unit_cost numeric(12,2) not null default 0
  check (unit_cost >= 0);
alter table public.sale_items add column if not exists unit_cost_is_estimated boolean not null default true;

-- Legacy product lines can only be estimated from current branch cost.
update public.sale_items si
set unit_cost = bp.cost_price,
    unit_cost_is_estimated = true
from public.sales s, public.branch_products bp
where si.sale_id=s.id and bp.branch_id=s.branch_id and bp.product_id=si.product_id
  and si.unit_cost=0 and bp.cost_price>0;

-- Legacy prescription-lens costs reconstructed from current price rows are estimates.
update public.sale_items si
set unit_cost =
      coalesce((select r.cost_price from public.sales s join public.branch_lens_prices r
        on r.branch_id=s.branch_id and r.id=nullif(si.technical_details->'right'->>'priceId','')::uuid
        where s.id=si.sale_id),0)
      + coalesce((select l.cost_price from public.sales s join public.branch_lens_prices l
        on l.branch_id=s.branch_id and l.id=nullif(si.technical_details->'left'->>'priceId','')::uuid
        where s.id=si.sale_id),0),
    unit_cost_is_estimated = true
where si.product_id is null and si.item_kind='prescription_lens' and si.unit_cost=0;

create or replace function public.capture_sale_item_unit_cost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_branch uuid; v_cost numeric(12,2); v_right_cost numeric(12,2); v_left_cost numeric(12,2);
begin
  if new.product_id is null and new.item_kind='prescription_lens' then
    select branch_id into v_branch from public.sales where id=new.sale_id;
    if not found then raise exception 'sale not found for sale item'; end if;
    select cost_price into v_right_cost from public.branch_lens_prices
      where id=nullif(new.technical_details->'right'->>'priceId','')::uuid and branch_id=v_branch and active;
    select cost_price into v_left_cost from public.branch_lens_prices
      where id=nullif(new.technical_details->'left'->>'priceId','')::uuid and branch_id=v_branch and active;
    if v_right_cost is not null and v_left_cost is not null then
      new.unit_cost:=round(v_right_cost+v_left_cost,2);
      new.unit_cost_is_estimated:=(v_right_cost<=0 or v_left_cost<=0);
    else
      new.unit_cost:=0;
      new.unit_cost_is_estimated:=true;
    end if;
    return new;
  elsif new.product_id is null then
    new.unit_cost := 0;
    new.unit_cost_is_estimated := true;
    return new;
  end if;
  select branch_id into v_branch from public.sales where id=new.sale_id;
  if not found then raise exception 'sale not found for sale item'; end if;
  select cost_price into v_cost from public.branch_products
   where branch_id=v_branch and product_id=new.product_id;
  if not found then raise exception 'product cost not configured for branch'; end if;
  new.unit_cost := coalesce(v_cost,0);
  new.unit_cost_is_estimated := coalesce(v_cost,0)<=0;
  return new;
end;
$$;
drop trigger if exists sale_items_capture_unit_cost on public.sale_items;
create trigger sale_items_capture_unit_cost
before insert on public.sale_items
for each row execute function public.capture_sale_item_unit_cost();

revoke all on function public.capture_sale_item_unit_cost() from public,anon,authenticated;
grant execute on function public.capture_sale_item_unit_cost() to service_role;

create index branch_lens_prices_type_idx on public.branch_lens_prices(lens_type_id);
create index lens_supplies_created_by_idx on public.lens_supplies(created_by);
create index lens_supply_items_product_idx on public.lens_supply_items(product_id);
create index products_created_by_idx on public.products(created_by);
create index stock_movements_product_idx on public.stock_movements(product_id);
create index stock_movements_created_by_idx on public.stock_movements(created_by);

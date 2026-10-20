-- Trigger functions are invoked by table triggers, not exposed as public RPCs.
revoke all on function public.record_purchase_supplier_ledger() from public, anon, authenticated;
revoke all on function public.record_lens_supply_supplier_ledger() from public, anon, authenticated;

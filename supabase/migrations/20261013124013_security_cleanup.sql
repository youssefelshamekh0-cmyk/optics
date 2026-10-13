-- This event-trigger function is invoked by Postgres itself, not by the Data API.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

-- Index the referencing sides of foreign keys used in joins or deletion checks.
create index if not exists audit_logs_actor_id_idx on public.audit_logs(actor_id);
create index if not exists role_permissions_permission_id_idx on public.role_permissions(permission_id);
create index if not exists user_permissions_permission_id_idx on public.user_permissions(permission_id);
create index if not exists user_roles_role_id_idx on public.user_roles(role_id);

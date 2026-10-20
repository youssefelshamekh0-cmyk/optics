-- Supplier balances and push notification infrastructure.
create table if not exists public.supplier_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete restrict,
  entry_type text not null check (entry_type in ('opening_debt','purchase','payment','adjustment')),
  amount numeric(14,2) not null check (amount > 0),
  direction text not null check (direction in ('debit','credit')),
  cash_account_id uuid references public.cash_accounts(id) on delete restrict,
  purchase_id uuid references public.purchases(id) on delete restrict,
  entry_date date not null default current_date,
  description varchar(500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists supplier_ledger_supplier_date_idx on public.supplier_ledger_entries(supplier_id, entry_date desc, created_at desc);
create index if not exists supplier_ledger_branch_date_idx on public.supplier_ledger_entries(branch_id, entry_date desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_key text not null,
  title varchar(160) not null,
  body varchar(500) not null,
  href varchar(500) not null default '/dashboard',
  entity_type varchar(100),
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists app_notifications_recipient_date_idx on public.app_notifications(recipient_user_id, created_at desc);
alter table public.push_subscriptions enable row level security;
alter table public.app_notifications enable row level security;
alter table public.supplier_ledger_entries enable row level security;

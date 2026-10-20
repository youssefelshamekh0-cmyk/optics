create table if not exists public.customer_prescriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  exam_date date not null default current_date,
  optometrist text,
  right_sphere numeric(6,2), right_cylinder numeric(6,2), right_axis numeric(6,2), right_add numeric(6,2),
  left_sphere numeric(6,2), left_cylinder numeric(6,2), left_axis numeric(6,2), left_add numeric(6,2),
  pupil_distance numeric(6,2),
  notes text,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_prescriptions_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint customer_prescriptions_optometrist_length check (optometrist is null or char_length(optometrist) <= 160)
);
create index if not exists customer_prescriptions_customer_exam_idx on public.customer_prescriptions(customer_id, exam_date desc);

create table if not exists public.sale_service_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  service_type text not null check (service_type in ('warranty','repair','maintenance','replacement')),
  status text not null default 'received' check (status in ('received','diagnosing','awaiting_parts','ready','delivered','cancelled')),
  issue text not null,
  warranty_until date,
  expected_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sale_service_issue_length check (char_length(issue) between 3 and 1000),
  constraint sale_service_notes_length check (notes is null or char_length(notes) <= 2000)
);
create index if not exists sale_service_records_customer_created_idx on public.sale_service_records(customer_id, created_at desc);
create index if not exists sale_service_records_branch_status_idx on public.sale_service_records(branch_id, status, expected_at);

create table if not exists public.customer_reminders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  sale_id uuid references public.sales(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  reminder_type text not null check (reminder_type in ('follow_up','annual_exam','ready_order','payment_followup','warranty_followup')),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  message text not null,
  completed_at timestamptz,
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_reminders_message_length check (char_length(message) between 2 and 1000)
);
create index if not exists customer_reminders_due_idx on public.customer_reminders(status, due_at);
create index if not exists customer_reminders_customer_due_idx on public.customer_reminders(customer_id, due_at desc);

alter table public.customer_prescriptions enable row level security;
alter table public.sale_service_records enable row level security;
alter table public.customer_reminders enable row level security;
revoke all on public.customer_prescriptions from anon, authenticated;
revoke all on public.sale_service_records from anon, authenticated;
revoke all on public.customer_reminders from anon, authenticated;

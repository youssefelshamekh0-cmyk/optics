-- Permit cancellation of a pending seller leave/permission request.
alter table public.staff_time_off_requests drop constraint if exists staff_time_off_requests_status_check;
alter table public.staff_time_off_requests add constraint staff_time_off_requests_status_check
  check (status in ('pending','approved','rejected','cancelled'));

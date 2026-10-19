# Comprehensive branch merge audit

## Candidate merge branch
- Branch: `merge/comprehensive-all-branches`
- Starting point: `fix/delivery-modal-daily-branch-ui` / PR #20
- The comprehensive branch preserves offline-first queue/idempotency, invoice/delivery handling, stock-take and inventory transfer foundations, central-cash and payroll improvements from PR #20.
- Added the branch/staff/finance/sales report panel from `phase2/invoices-inventory-audit` and wired the reports into workspace tabs without replacing the newer offline-aware workspace.\n- Normalized `/api/account` to support both the existing account section and the newer employee panel, including weekly payroll, advances and leave requests.\n- Adapted the logo settings UI to the production `logo_data_url` API contract and its 1 MiB limit.\n- Connected customer-ordered lens receiving to the existing production `receive_lens_order` RPC and `supply_status` state, avoiding a call to the unrelated `receive_ordered_lenses` RPC.

## Branches reviewed
- `feat/daily-all-branches-delivery-complete`
- `feat/daily-register-list-per-branch`
- `feat/staff-requests-central-payroll`
- `feature/weekly-pay-account-lens-orders`
- `fix/auto-select-central-expense-account`
- `fix/central-expense-source`
- `fix/daily-list-and-central-expense-save`
- `fix/daily-register-list-and-expense-account`
- `fix/expense-save-and-daily-register-tab`
- `fix/homepage-daily-overview-restore`
- `fix/payroll-payout-missing-rpc`
- `fix/published-payroll-row-state`
- `phase2/invoices-inventory-audit`

## Database notes
- Production and staging have schema drift in `public.brand_settings`: production has `logo_data_url`; staging has `brand_name` and `logo_path`. Do not deploy a storage-backed logo API requiring `logo_path` into production unchanged.
- Production security hardening was applied to `sale_returns` and `sale_return_items`: direct grants were revoked from `anon` and `authenticated`; `service_role` retains access; `process_sale_return` is executable only by `service_role` (and database owner).
- Do not apply the feature migrations wholesale as part of deployment: production and staging already have their migrations recorded, with slightly different migration timestamps/names.

## Validation still required before production cutover
- GitHub Actions typecheck/build and dependency audit on the latest aggregate commit (the preceding commit passed all three checks; a new run is in progress after lens receiving was corrected).
- Authenticated preview smoke test for owner and seller roles (the existing preview requires login).
- Runtime tests for offline sale/customer synchronization and retry idempotency.
- Runtime tests for branch-scoped daily registers, central expenses/deposits, payroll payout idempotency, sale returns, stock takes/transfers and lens receiving.
- Verify report filters and printed/PDF output against live API results.
- Review the remaining Supabase security/performance advisor findings; do not add blanket RLS policies to service-role-only tables.

## Explicit non-claims
This document does not claim that browser-level E2E tests have passed. Production was not deployed as part of creating this candidate branch.

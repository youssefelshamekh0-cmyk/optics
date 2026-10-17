# Comprehensive update checklist

This work stays on `fix/delivery-modal-daily-branch-ui` / PR #20. Do not merge to `main`, apply migrations to production, or deploy production while this checklist is open.

## Already included in PR #20
- Delivery modal/table and daily-register UX refinements.
- Super-admin brand logo upload and branded print layouts.
- Weekly/monthly employee payroll reports and statements.
- Weekly/monthly brand/branch financial reports and daily collection attribution.
- Owner-confirmed manual non-cash treasury deposits with paired ledger entries.

## Offline-first foundation added in this update
- [x] IndexedDB cache scoped to the signed-in user for sales lists, branch catalog, lens pricing lookups, and customer searches.
- [x] Durable local outbox for sales created while disconnected.
- [x] Transactional database idempotency key around sale creation so retries cannot create a second invoice for the same operation.
- [x] Sync status panel with pending, successful, rejected, and inventory-conflict states.
- [x] Automatic retry when the connection returns; conflict/rejected operations remain visible for review.
- [ ] Offline app shell must remain usable after a full browser reload (currently the service worker still falls back to the static offline page).
- [ ] Offline customer creation and client-generated customer IDs/dependency mapping.
- [ ] Editable conflict resolution (review and correct the queued sale before retrying, rather than only retrying the same payload).
- [ ] Explicit local-data cleanup and account-switch/logout behavior testing on shared POS devices.
- [ ] Offline payments, returns, stock adjustments, expenses, payroll, and treasury are intentionally not queued yet; each needs a safe idempotent ledger contract before enabling offline writes.

## Remaining comprehensive improvements
- [ ] Audit every API route for branch-level authorization, role permissions, same-origin protection, and service-role access patterns.
- [ ] Review RLS and database grants for all exposed tables, views, and RPC functions; add only policies that match the actual access model.
- [ ] Financial reconciliation: compare ledger movements with calculated balances, sales with collections/receivables, cash counts with expected balances, and flag over/short differences.
- [ ] Protect every money-moving action against duplicate submissions and wrong-account/wrong-branch payouts; corrections should be append-only audited entries.
- [ ] Inventory: stock counts/adjustments, branch transfer dispatch and receipt, low-stock alerts, cost/profit visibility, and a complete movement audit trail.
- [ ] Returns/refunds: verify refund account, stock restoration, permissioned corrections, and duplicate refund protection.
- [ ] Reporting: branch/product margin and profitability, overdue receivable aging, slow-moving items, and salesperson performance.
- [ ] Automated tests for sale/payment/return/treasury idempotency, inventory races, branch isolation, and permissions.
- [ ] Validate migrations on isolated staging, run the production build and tests, perform a backup/restore rehearsal, and document rollback before review.

## Acceptance checks before merge
1. Two or more devices can create separate offline sales and later sync without duplicate invoices.
2. A stock conflict is visible and never silently accepted; the server remains authoritative for final stock and pricing.
3. A user cannot view or sync another user's cached data or queued operations.
4. Financial totals reconcile to the ledger and all sensitive actions are auditable.
5. All migrations and tests pass on isolated staging, and the build status is verified.

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
- [x] Private dashboard shell caching for offline reloads, with cache purge on logout/redirect; API responses are not cached by the service worker.
- [x] Durable local outbox for sales and customer creation while disconnected.
- [x] Local customer IDs are resolved to server IDs before dependent invoices are synchronized.
- [x] Transactional database idempotency key around sale creation and customer creation.
- [x] Sync status panel with pending, successful, rejected, and inventory-conflict states.
- [x] Editable queued sale quantities/totals and editable customer details before retrying a rejected/conflicting operation.
- [x] Automatic retry when the connection returns; user-scoped cache and queue.
- [ ] Validate full reload, offline sale creation, two-device synchronization, session expiry, logout/account switching, and browser storage pressure in real browsers.
- [ ] Offline payments, returns, stock adjustments, expenses, payroll, and treasury are intentionally not queued yet; each needs its own safe idempotent ledger contract before enabling offline writes.

## Financial integrity and cash controls
- [x] Cash account balances in the operations view now use the full ledger balance RPC rather than summing only the latest 1,000 movements.
- [x] Add append-only cash count reconciliation snapshots (book balance vs actual count), variance display, history, and audit events.
- [x] Make sale payment retries idempotent using an operation ID, alongside the existing return idempotency key; enforce globally unique return operation IDs.
- [x] Preserve return idempotency keys in the UI across uncertain responses; edits rotate the key.
- [x] Keep corrections and cash count differences as auditable records; cash count does not silently modify the ledger.
- [ ] Add end-to-end reconciliation tests covering duplicate submissions, concurrent payments, account balances, returns, and branch isolation.

## Inventory and profitability
- [x] Add per-branch low-stock thresholds and low-stock warnings.
- [x] Add an atomic stock-take workflow that records expected/count quantities and writes adjustment movements for differences.
- [x] Split branch transfers into dispatch and receipt; stock leaves the source on dispatch and enters the destination only after receipt confirmation.
- [x] Add idempotency keys to stock takes, transfer dispatch, and inventory adjustments.
- [x] Capture a sale-line unit-cost snapshot for future profitability reports; historical cost snapshots are explicitly marked estimated.
- [x] Add branch/product gross-profit and margin reports, receivables aging, slow-moving stock, and salesperson performance; include the insights in print/PDF output.
- [ ] Validate cost averages, transfer receipt races, stock-take concurrency, return stock restoration, and historical-cost caveats against real staging data.

## Security and release readiness
- [x] Scope customer search/directory results for non-owners to customers linked to their accessible branches or created by them.
- [x] Review and harden the touched customer, payment, transfer, stock-take, cash-reconciliation, and reporting API paths with permission and branch checks.
- [x] Use module-specific permissions for operations reads, restrict cash-account creation to the owner, and require owner approval for inventory writes.
- [x] Persist cost snapshots for stock products and prescription lenses; mark legacy cost values as estimates.
- [ ] Finish route-by-route authorization/RLS/grant review for every API route, view, and RPC.
- [ ] Add automated tests for sale/payment/return/treasury idempotency, inventory races, branch isolation, and permissions.
- [ ] Reconcile the existing staging migration baseline first (staging currently records only `20261017125800 deliver_sale_collect_balance` despite having the app schema), then apply migrations only to isolated staging; run migration validation, production build, smoke tests, and a backup/restore rehearsal.
- [x] Document detailed staging test scenarios and environment guardrails in `docs/staging-validation-plan.md`.
- [ ] Verify build/deployment checks and document rollback before review.

## Acceptance checks before merge
1. Two or more devices can create separate offline sales and later sync without duplicate invoices.
2. An inventory conflict remains visible and is never silently accepted; the server stays authoritative for stock and pricing.
3. A user cannot view or sync another user's cached data or queued operations.
4. Cash counts reconcile against the complete ledger and all money-moving operations are idempotent and auditable.
5. Inventory dispatch, receipt, stock take, and return movements remain consistent.
6. All migrations and tests pass on isolated staging, and the build status is verified.

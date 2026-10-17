# Staging validation plan — PR #20

## Environment safety
- Target project: `optics-staging` (Supabase project ref `bvdobfbtjsebdauxghlx`).
- Production project ref: `jcowjkxepirekkapmivn`; do not apply feature migrations or run write tests there.
- Current staging schema contains the existing application tables, but Supabase migration history reports only `20261017125800 deliver_sale_collect_balance`. Reconcile the baseline/history before applying the new feature migrations; do not blindly replay the entire migration directory.
- The staging security advisor currently reports 35 tables with RLS enabled but no policies. A read-only grant check showed no direct table grants to `anon` or `authenticated`, and the inspected security-definer RPCs were not executable by those roles. Keep the service-role-only API model and do not add broad RLS policies just to silence the informational advisor.
- Current Vercel build status has failed because of the build-rate limit; no successful build is verified.

## Migration sequence added in the feature branch
1. `20261017210000_offline_sync_idempotency.sql`
2. `20261017220000_offline_customer_idempotency.sql`
3. `20261017230000_stock_takes_low_stock.sql`
4. `20261017240000_sale_item_cost_snapshot.sql`
5. `20261017250000_cash_reconciliation.sql`
6. `20261017260000_sale_payment_idempotency.sql`
7. `20261017270000_inventory_transfer_dispatch_receipt.sql`

These files are not applied to staging or production. Before staging execution, verify dependency ordering and baseline compatibility, especially the current signature/grants for `financial_operation_keys`, `inventory_transfers`, `stock_movements`, `cash_account_balance`, and `create_optics_sale`.

## Functional test matrix

### Offline queue and identity
- Sign in as a salesperson, load branch list, products, lens pricing, customer search, and sales list while online.
- Disconnect, reload `/dashboard`, confirm the cached shell and branch selector load without exposing another user's shell.
- Create an offline customer, then create an invoice for that local customer; verify the invoice remains queued until the customer gets a server ID.
- Restore connectivity; confirm the customer syncs first, the invoice payload is rewritten to the server customer ID, and the invoice is created exactly once.
- Simulate a response timeout after a successful sale/payment/return and retry with the same operation ID; confirm no duplicate invoice/payment/refund.
- Force insufficient stock, duplicate phone, expired session, and server 5xx responses; confirm conflicts/rejections remain visible and queued sales do not bypass validation.
- Log out and sign in as a different user on the same device; confirm cached branch/customer data and outbox entries are not shown or synced under the second account.

### Financial integrity
- Verify account balances against `cash_account_balance` with more than 1,000 transactions.
- Record cash counts below, equal to, and above book balance; confirm signed variance and immutable history without automatic ledger mutation.
- Submit the same payment operation ID twice; confirm one `sale_payments` row and one matching cash transaction.
- Submit the same operation ID with changed amount/account; confirm conflict rather than duplicate movement.
- Race two payments against the same remaining balance; confirm row locking prevents over-collection.
- Confirm collection reports attribute payments to the payment date even when the invoice was created earlier.

### Inventory and returns
- Stock take with no differences, positive differences, and negative differences; verify item snapshots, branch stock, and matching adjustment movements.
- Retry identical stock take ID and then reuse it with changed counts; verify idempotent replay and mismatch rejection.
- Dispatch a transfer; source stock decreases while destination stock remains unchanged until receipt.
- Receive once and retry receipt; verify destination quantity is added once, source/destination movements match, and average cost is weighted.
- Attempt receipt from a user without destination branch access; expect 403.
- Return items partially and fully; verify refund account, paid-amount cap, stock restoration, cash-out movement, and duplicate-return prevention.
- Confirm low-stock thresholds are branch-specific and zero disables the warning.

### Reporting and permissions
- Compare product/branch gross profit with invoice lines, discounts, returns, and cost snapshots; flag historical estimated costs.
- Verify receivables aging buckets and salesperson collections/returns for invoices created outside the report period.
- Confirm branch-scoped users cannot search unrelated customers or read another branch's invoices/payments/transfers.
- Verify direct Data API access remains denied for `anon` and `authenticated`; verify service-role-only functions have no unintended execute grants.
- Run the complete production build and smoke tests; capture logs, migration output, and backup/restore evidence before merge.

## Acceptance gate
No merge/deploy until the migration baseline is reconciled, all migrations succeed on isolated staging, test results are recorded, security review is complete, and a successful build is verified.

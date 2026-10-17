# Phase 2 — Invoices & Inventory Audit

Status: source changes committed to the isolated phase2 branch; not tested, not deployed, no production database writes, and no merge to main.

## Scope
- Invoice totals, discounts, paid amount, and outstanding balance
- Concurrent sales against the same branch/product stock
- Transfers between branches
- Returns/refunds and stock reversal

## Environment gate
The connected Supabase account currently lists only one project: `optics system` (`jcowjkxepirekkapmivn`). A separate staging project has not been confirmed. Do not run write/integration/concurrency tests against this project until a separate staging database is created and its schema/migrations are reconciled.

## Findings from source review
1. The sales workflow migration defines `create_optics_sale` to calculate item total in the database and derive grand total as item total minus discount. Confirm the deployed database has this exact function and migration before relying on it.
2. Invoice balances should satisfy: `grand_total = total_amount - discount_amount`, `paid_amount = SUM(sale_payments.amount)`, and `remaining = grand_total - paid_amount`. A negative remaining balance must be reported as an invariant violation, not hidden by clamping it to zero.
3. `record_sale_payment` locks the sale row before summing prior payments and checking remaining balance. This is a promising concurrency guard, but needs staging tests for simultaneous payments and duplicate submissions.
4. Inventory transfer logic is implemented in the operations finance/HR migration. Test source/destination locking, absent destination stock row, insufficient stock, and rollback if any movement insert fails.
5. Added a staged return/refund migration and API endpoint on this branch. It locks the invoice and sale-item rows, limits returned quantity to sold quantity, limits refunds to net paid amounts, restores product stock, and writes a cash-out ledger entry. It has not been run; review schema/constraint compatibility and test it on staging before applying.

## Required staging test matrix
- Invoice: exact total, allowed discount, discount larger than subtotal, zero/negative payment, payment equal to balance, payment exceeding balance.
- Concurrent payment: two requests whose combined amounts exceed remaining balance; assert no overpayment.
- Concurrent sale: two requests competing for the last unit; assert stock never becomes negative and only valid sales commit.
- Transfer: valid transfer; same branch; quantity <= 0; insufficient source stock; missing destination stock row; concurrent transfers; forced failure and full rollback.
- Return: full and partial return; duplicate return request; return quantity greater than sold quantity; cancelled invoice; stock and cash/payment ledger reconciliation.
- Reconciliation: invoice totals vs line totals and discounts; paid vs payment rows; stock balance vs movement ledger.

## Acceptance criteria
- All writes for a sale/payment/transfer/return are atomic.
- No stock balance falls below zero.
- A payment cannot make paid amount exceed grand total.
- Duplicate submissions cannot duplicate financial or inventory effects.
- Every return records both the financial disposition and the stock disposition, with authorization and an auditable reference.
- Tests run only on isolated staging data; attach results to the pull request before review.

## Changes committed on the phase2 branch
- Validate that the final invoice total is positive and does not exceed the calculated item total; derive and persist the discount in the database function.
- Lock invoice stock rows in product-ID order to reduce deadlocks when concurrent sales include the same products in different orders.
- Return exact remaining balances and a `payment_balance_error` flag instead of silently clamping overpayment to zero.
- Add `process_sale_return` migration and `POST /api/sales/[id]/returns` endpoint for partial/full item returns, stock restoration, refund cap, cash ledger, permission check, and audit log.
- Preserve existing cash transaction types (`payroll_advance` and `central_deposit`) when adding `sale_refund`; this compatibility change is source-only until staging validation.
- Prorate invoice discounts across returned item quantities so a return uses the effective discounted unit price rather than the reference price.

## Next implementation gate
Create/confirm an isolated Supabase staging project, configure Vercel Preview environment variables to use it, reconcile schema/migrations, then run build and write/concurrency tests there. Do not apply migrations or test writes against production.

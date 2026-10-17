# Phase 2 — Invoices & Inventory Audit

Status: investigation only. No production database writes, no production deployment changes, and no merge to main.

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
5. Repository search did not identify a complete return/refund flow. The presence of a `return` stock movement type alone does not implement a safe return workflow.

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

## Next implementation gate
Create/confirm an isolated Supabase staging project, configure Vercel Preview environment variables to use it, and reconcile schema/migrations there. Only then implement fixes and run write/concurrency tests.

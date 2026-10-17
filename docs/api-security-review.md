# API security review — feature branch

This is a source-level review of the API routes on `fix/delivery-modal-daily-branch-ui`. It is not a substitute for executing permission tests against the isolated staging database.

## Controls applied or tightened in this update

- **Authentication:** protected API routes resolve the current user server-side; unauthenticated requests are rejected.
- **Mutation origin:** state-changing routes use the existing same-origin guard.
- **Branch isolation:** branch-scoped reads and writes validate the requested branch against the user's assigned branch IDs. Operations reads now require module-specific permissions and reject branch-scoped requests for users with no active branch assignment.
- **Customer records:** customer search is limited to accessible-branch sales and customers created by the current user; customer updates now apply the same visibility rule unless the actor is the super-admin.
- **Owner-only actions:** central treasury deposits, cash reconciliation, cash-account creation, employee/payroll administration, stock takes, and inventory adjustments/transfers require the super-admin.
- **Purchase payment accounts:** a purchase payment must use an active cash account belonging to the selected branch; central treasury accounts are not accepted for branch purchases.
- **Idempotency:** sale creation, customer creation, sale payments, expenses, payroll payments, stock adjustments, stock takes, transfer dispatch, cash reconciliation, and sale returns use operation keys or existing uniqueness/status guards.
- **Ledger consistency:** sale payment creation writes the payment row and matching cash transaction atomically. Financial reports compare collections against cash-ledger inflows, use ledger dates for paid expenses/supplier payments/payroll, and surface unmatched/mismatched movements.
- **Database exposure:** new operational tables use RLS and revoke direct table access from `anon` and `authenticated`; new privileged RPCs revoke execute from public client roles and grant it to `service_role`.

## Route groups reviewed

| Route group | Main access boundary |
|---|---|
| `/api/auth/*` | Login/logout/session and current-user audit |
| `/api/account` | Current user only |
| `/api/branches/*`, `/api/users/*` | Super-admin administration; branch lists scoped to assigned branches |
| `/api/customers/*`, `/api/sales/customers` | Customer visibility by created-by or accessible-branch sales |
| `/api/sales/*` | Sales permissions, branch checks, same-origin writes, idempotent money operations |
| `/api/dashboard`, `/api/daily` | User's branches or owner-only consolidated view |
| `/api/operations` | Module-specific permissions, branch filtering, owner-only sensitive operations |
| `/api/inventory/*` | Owner-only inventory writes and stock counts; branch-scoped stock reads |
| `/api/financial-reports/*`, `/api/staff-reports` | Super-admin only |
| `/api/lens-prices`, `/api/lens-supplies/*` | Super-admin management |
| `/api/shifts` | Actor/shift ownership and branch checks |
| `/api/brand-settings` | Authenticated brand-logo read; super-admin write |

## Must be verified on isolated staging before merge

- Confirm every exposed public-schema table has RLS enabled and no unintended grants to `anon` or `authenticated`.
- Confirm every privileged RPC has the intended execute grants and uses a fixed search path when running as `SECURITY DEFINER`.
- Test direct requests against another branch's IDs for each read and mutation route; expect 403/404 and no side effects.
- Test simultaneous duplicate requests for payment, expense, payroll, return, adjustment, stock take, and transfer; each must produce at most one ledger/stock movement.
- Reconcile the staging migration baseline/history first. The current staging history has only one recorded migration despite the application schema existing, so do not blindly replay all migrations.
- Run a successful production build and the full staging validation plan. The current Vercel result is a build-rate-limit failure, not a passing build.

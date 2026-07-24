# PayMind AI — Installment Management System

Production-ready Next.js 15 app for managing installment-based sales:
clients, contracts, auto-generated installment schedules, payments with
automatic allocation, an invite-only admin/partner auth system, a full
investor / business-phase / profit-distribution / withdrawal module —
and an offline-first PWA layer so it works as a downloadable, installable
app on mobile that keeps functioning with no signal.

All three phases are implemented and verified end-to-end:

- **Phase 1** — Clients, Contracts, Payments, Dashboard, Auth
- **Phase 2** — Investors, Business Phases, Investor Phase Investments,
  Profit Distribution, Withdrawals
- **Phase 3** — Offline support (Dexie local cache + sync queue),
  installable PWA (service worker, icons, install prompt)

---

## Tech Stack

- **Next.js 15** (App Router, Server Components, Server Actions, Route Handlers)
- **TypeScript** (strict mode)
- **Tailwind CSS v4** + hand-built shadcn/ui-style components (Radix primitives)
- **Supabase** (PostgreSQL + Auth)
- **Zod** for validation (used identically client-side and server-side)
- **Dexie** (IndexedDB) for the offline cache + outbox queue
- A hand-written service worker for app-shell caching (no external PWA library)

---

## 1. Setup

### 1.1 Install dependencies

```bash
npm install
```

### 1.2 Run the SQL migrations, in order

You already created the 10 base tables. Run these in your Supabase
project's SQL editor (Dashboard → SQL Editor → New query → paste → Run),
**in this exact order, each exactly once**:

**`supabase/sql/001_phase1_migration.sql`**
- `is_deleted` column on `clients` (soft delete)
- `user_profiles` table (roles: `admin` / `partner`) + auto-create trigger
- `next_client_code()` / `next_contract_code()` — atomic sequential codes
- `updated_at` / `sync_version` auto-touch triggers
- RLS: any authenticated staff member has full access to business tables

**`supabase/sql/002_phase2_migration.sql`**
- `withdrawals` table
- `profit_distributed` / `profit_distributed_at` guard columns on `contracts`
- RLS for investors/phases/investments/distributions/withdrawals
- `distribute_contract_profit(contract_id)` — atomic, row-locked profit split
- `investor_available_balance(investor_id)` — single source of truth for withdrawals

**`supabase/sql/003_withdrawal_race_fix.sql`**
- `create_withdrawal_with_balance_check(...)` — atomic, row-locked withdrawal
  creation, closing a race window in the original two-step balance check

### 1.3 Create the seed admin account

No public sign-up page exists. To create your first admin account:

1. Supabase Dashboard → Authentication → Users → **Add user**
2. Enter an email and password
3. Under "User Metadata" (raw JSON):
   ```json
   { "role": "admin", "full_name": "Your Name" }
   ```
4. Save — the `handle_new_user()` trigger creates the matching
   `user_profiles` row automatically.

Once logged in, use **Team** to invite the other two partner accounts —
they'll get an email invite and set their own password. Inviting
requires a live connection (see [Offline Behavior](#3-offline-behavior)).

### 1.4 Environment variables

```bash
cp .env.local.example .env.local
```

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # server-only
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 1.5 Set up your first business phase

Before any contract can have its profit distributed, create at least
one investor and one business phase with an investment in it: **Investors**
→ New Investor, then **Business Phases** → New Phase → open it → **Add
Investment**. Until then, contracts still complete normally — the
dashboard just shows a reminder banner.

### 1.6 Run it

```bash
npm run dev      # development
npm run build    # production build
npm start        # serve the production build
```

The service worker (the thing that makes this installable and able to
open with no connection) **only registers in production builds** —
`npm run dev` deliberately skips it, since Next's dev server constantly
recompiles and a caching service worker fighting that is more confusing
than helpful locally. To actually test the offline/install experience,
use `npm run build && npm start`.

### 1.7 Installing on a phone

Once deployed (or running via `npm start` and accessed from a phone on
the same network):

- **Android/Chrome**: a custom "Install Sitara Traders" card appears
  automatically after a few seconds of use (see `InstallPrompt`
  component). Tapping **Install** adds it to the home screen as a
  standalone app — no browser chrome, its own icon, opens full-screen.
- **iPhone/Safari**: iOS doesn't support the install-prompt API at all
  (an Apple platform restriction, not something this app can work
  around). Open the site in Safari → Share button → **Add to Home
  Screen**. Same end result — a home-screen icon that opens full-screen.

---

## 2. Architecture

```
src/
├── app/
│   ├── (auth)/login/
│   ├── (dashboard)/               # Authenticated app shell
│   │   ├── dashboard/ clients/ contracts/ payments/
│   │   ├── investors/ phases/ distributions/ withdrawals/
│   │   ├── sync/                  # NEW — offline sync queue, retry/discard
│   │   └── users/
│   └── api/
│       └── sync/route.ts          # NEW — re-validates & replays queued offline writes
├── components/
│   ├── ui/                        # shadcn-style primitives
│   ├── layout/  clients/  contracts/  payments/  investors/  phases/  shared/
│   └── offline/                   # NEW
│       ├── offline-status-badge.tsx     # top-bar indicator, links to /sync
│       ├── offline-sync-provider.tsx    # mounts the shared sync context + cache warmer
│       ├── service-worker-registration.tsx
│       ├── install-prompt.tsx            # custom beforeinstallprompt UI
│       └── pending-payments-banner.tsx   # shows queued payments on a contract page
├── lib/
│   ├── supabase/  services/  actions/  validations/  utils/
│   └── offline/                   # NEW
│       ├── db.ts                  # Dexie schema (cache tables + outbox)
│       ├── outbox.ts              # queue CRUD (enqueue/retry/discard)
│       ├── sync-engine.ts         # drains the outbox, resolves temp-ID deps
│       ├── cache-refresh.ts       # pulls a server snapshot into Dexie
│       ├── use-online-status.ts   # real connectivity check, not just navigator.onLine
│       ├── use-offline-sync.ts    # orchestration hook (auto-sync, periodic refresh)
│       ├── offline-sync-context.tsx  # shares one sync-state instance app-wide
│       ├── guards.ts              # registry of operations that require a live connection
│       └── offline-routes.ts      # shared source of truth for offline-capable static routes
├── types/
└── middleware.ts

public/
├── manifest.json                  # PWA manifest (icons, shortcuts, display mode)
├── sw.js                          # NEW — hand-written service worker (app-shell caching)
└── icons/                         # NEW — generated 192/512/maskable/apple-touch icons
```

### How offline actually works here

**The core design decision: writes are either *queueable* or *online-only*,
never "best-effort offline."**

Queueable (safe to do with no connection, replayed later):
- Create / edit client
- Create / edit contract (editing financial terms is blocked once
  payments exist on that contract — both client-side before queuing,
  and again server-side at sync time, since the contract may have
  gained payments on another device in the meantime)
- Record a payment

Online-only (blocked in the UI with a clear message if offline):
- **Distribute profit**, **create withdrawal** — both rely on atomic,
  row-locked Postgres functions (`distribute_contract_profit`,
  `create_withdrawal_with_balance_check`) specifically to prevent
  double-distribution / double-withdrawal under concurrent access. That
  guarantee only exists with a live connection. Queuing these offline
  would mean re-implementing distributed locking on a phone — not worth
  the risk for an operation that moves real money.
- **Invite team member**, **create investor**, **create business
  phase**, **add investor investment** — lower financial risk, but kept
  online-only to keep these records simple to reconcile and because they
  either need to send an email (invite) or directly affect profit-split
  math (investments/phases). The full reasoning per operation is in
  `lib/offline/guards.ts`.

**Why "latest write wins" isn't the conflict strategy.** A naive offline
sync usually just overwrites server data with whatever the client has
when it reconnects. That's dangerous for money: if two partners are
offline at the same time and one cycles back online while the other is
still mid-payment-entry, "latest wins" can silently drop a real payment.
Instead, every queued operation is replayed through the exact same
service-layer functions the online UI uses (`createClientRecord`,
`createContractRecord`, `recordPayment` — see `app/api/sync/route.ts`).
The offline client never computes or sends a final installment
allocation or balance; it sends *intent* ("Rs. 5,000 was paid on this
date against this contract"), and the server recomputes the real
allocation fresh, against current data, at sync time. This is what makes
the "append, don't overwrite" model safe — we're replaying actions, not
merging conflicting numbers.

**Why a contract created offline for a client created offline (in the
same session) still works.** An offline-created client is cached
immediately under a negative placeholder ID so it shows up right away
in the contract form's client picker. If a contract is created
referencing that placeholder before the client has synced, the sync
engine (`syncOutbox` in `sync-engine.ts`) processes the outbox in
creation order, learns the client's real ID the moment its own entry
syncs successfully, and rewrites the dependent contract's `clientId` to
the real value before syncing it. No manual dependency wiring needed
beyond that — it falls out of processing strictly oldest-first plus a
small ID-rewrite map kept for the duration of one sync pass.

**What the service worker does and doesn't cache.** It caches the *app
shell* (JS/CSS bundles, icons, manifest) so the app can actually open
with zero connectivity — not just show stale data, but load at all. It
deliberately never caches `/api/*` routes or Supabase requests; a
service-worker HTTP cache sitting in front of the sync endpoint could
serve a stale "success" for a financial write, which is exactly the
class of bug this app can't afford. Real offline data access goes
through Dexie, which has actual sync semantics — not through the
service worker's cache.

**Type safety note carried over from earlier phases:** `types/database.ts`
Row types use `type` aliases, not `interface` — Supabase JS v2's generic
resolution silently collapses query results to `never` when Row shapes
are `interface`-declared. Verified via isolated type-probe testing;
`npx tsc --noEmit` is clean across the whole codebase.

---

## 3. Offline Behavior — what a partner actually sees

**Going offline mid-session:** a red "Offline" badge appears in the top
bar immediately. Forms for clients, contracts, and payments keep working
— each shows a small "Offline — this will be queued" notice and submits
into the local queue instead of over the network. Money-critical actions
(Distribute Profit, Record Withdrawal, Invite Partner, etc.) grey out
with a tooltip explaining they need a connection.

**Which pages actually work cold-offline, and how:**

- **`/dashboard`, `/clients`, `/clients/new`, `/contracts`, `/contracts/new`**
  are guaranteed to open offline from a completely cold start (e.g. opening
  the installed app on a phone that's been in airplane mode since before
  launch), because the service worker (`public/sw.js`) precaches their
  HTML shell and a client-side warm-up
  (`service-worker-registration.tsx`) explicitly fetches and caches each
  one's real JS chunks right after the service worker activates. `/clients`
  and `/contracts` are also fully *reactive* offline — they're Client
  Components that read live from the Dexie cache via `useLiveQuery`, so
  the list updates immediately as the sync queue drains once you're back
  online, with no page reload needed.
- **`/contracts/[id]`** (an individual contract's detail page) is
  opportunistically cached: if you've opened that specific contract at
  least once while online, its page (and the JS it needs) gets cached
  automatically, and the warm-up additionally pre-warms both the detail
  page and the edit page for the 50 most-recently-updated contracts in
  your Dexie cache right after every reconnect — so in practice, most
  contracts you've worked with recently open fine offline from a cold
  start too, for viewing and editing alike. **Important caveat:** unlike
  `/clients`/`/contracts`, this page is server-rendered, so the balance/
  installment/payment numbers shown are frozen at whatever they were the
  last time that exact page was successfully loaded online — they do
  *not* live-update from Dexie the way the list pages do. The amber
  "payments queued" banner on that page exists specifically to flag this:
  it tells you the displayed balance hasn't accounted for anything queued
  since. The **Record Payment** button and the **Edit Contract** form
  both still work correctly offline regardless of that staleness — each
  is a Client Component that queues its own intent independently of
  whether the page around it is stale, and editing specifically checks
  (both before queuing and again server-side at sync time) that
  financial terms aren't being changed on a contract that already has
  payments.
- **`/users`, `/investors`, `/phases`, `/payments`, `/distributions`,
  `/withdrawals`** have no offline path by design — they either need a
  live connection for what they do (inviting someone, anything touching
  profit-split math) or just haven't been built with a Dexie-backed view
  yet. Opening one offline falls back to the `/dashboard` shell rather
  than a browser error, but won't show that page's actual content.

**While offline:** the **Sync Queue** page (`/sync`, also linked from the
top-bar badge) lists everything waiting to go out, oldest first, with
its type and queued time.

**Coming back online:** sync starts automatically — no button to press.
A toast confirms how many changes synced; anything that fails (e.g. a
duplicate CNIC that only the server can catch) stays in the queue marked
**failed** with the actual error message, and a retry/discard action
right there. Nothing is ever silently lost or silently retried forever.

**Browsing offline:** clients, contracts, installments, and recent
payments are readable offline from the Dexie cache, refreshed
automatically every 2 minutes while online and once right after login,
so the cache is never far behind when connectivity actually drops. This
is a "recent + active" cache (most recent 500 clients/contracts, most
recent 1000 payments) — intentionally not a full historical replica,
since that's what a 3-person shop's *working set* actually looks like,
not its entire multi-year archive.

**Why the status filter on `/contracts` is plain client state, not a URL
query param:** it originally was `?status=ACTIVE` etc., which seems
harmless but isn't — the service worker caches by exact URL, and only
the bare `/contracts` was ever in the precache/warm-up list. Clicking a
status tab offline navigated to a URL that was never cached, which
silently failed and fell back to the dashboard shell (it looked like "the
filter shows nothing," but the real cause was a failed navigation, not a
filtering bug). Making the filter pure in-memory state means clicking a
tab never triggers a new page load at all — online or offline, it's the
same page, just rendering a different subset of whatever's already loaded.



---

## 4. What's Implemented (Full Detail)

### Phase 1 — Core business
- Invite-only auth (admin/partner roles), no public registration
- Clients: CRUD, search, soft delete, auto `CL-0001` codes
- Contracts: auto-calculated profit/total/installment amounts,
  auto-generated installment schedule, optional guarantor, auto
  `CNT-0001` codes, validates client exists/isn't deleted before any work
- Payments: auto-allocated oldest-installment-first, handles partial/
  exact/overpayment/early-payoff, audited edits (frozen once profit is
  distributed for that contract)
- Overdue detection, global search (clients/contracts/investors),
  blue/white finance UI, mobile-responsive grouped sidebar

### Phase 2 — Investors & profit distribution
- Investors: CRUD, soft deactivation, hard-delete blocked if there's any history
- Business Phases: create/close, only one active at a time, auto-closes the previous
- Investor Phase Investments: amounts only (percentages always computed live),
  removal blocked once a phase has distributions recorded against it
- Profit Distribution: automatic on contract completion, atomic + row-locked,
  guarded so it can only ever happen once per contract; manual retry button
  if no phase existed yet at completion time
- Withdrawals: atomic balance-check-and-insert, can never overdraw an investor
  even under concurrent requests

### Phase 3 — Offline & PWA
- Dexie local cache (clients, contracts, installments, payments) + outbox queue
- `/clients` and `/contracts` are reactive offline list views — Client
  Components reading live from Dexie via `useLiveQuery`, not frozen
  server-rendered snapshots, so they update immediately as the sync
  queue drains
- Online-capable forms (client, contract, payment) detect connectivity and
  branch between direct Server Action submission and local queueing
- Server-side sync endpoint (`/api/sync`) replays queued writes through the
  same validated service-layer functions as the online UI — never trusts
  client-computed totals or allocations
- Temp-ID dependency resolution for "client created offline → contract
  created offline against that client, before either has synced"
- Online-only guard registry + UI treatment for profit distribution,
  withdrawals, invites, investor/phase/investment creation
- Sync Queue page: see pending/syncing/failed operations, retry or discard
- Real connectivity detection (verifies via an actual fetch, not just
  `navigator.onLine`, and re-checks every 30s)
- Cold-start offline page loading: a client-side warm-up
  (`service-worker-registration.tsx`) parses each offline-capable page's
  real HTML for its current build's JS chunk URLs and explicitly
  fetches them right after the service worker activates — necessary
  because Next.js chunk filenames are content-hashed per build and
  can't be hardcoded ahead of time. The same mechanism additionally
  pre-warms the 100 most-recently-updated contract detail pages from
  the Dexie cache on every reconnect.
- Installable PWA: manifest with real generated icons (192/512/maskable/
  apple-touch), hand-written service worker caching the app shell only
  (never API/data — that risk is explained above), custom install prompt
  for Android/Chrome, standard Add-to-Home-Screen flow for iOS Safari

---

## 5. What's Genuinely Not Built

Everything originally scoped across all three conversations is now
implemented. The remaining gaps are deliberate, documented engineering
tradeoffs, not missing features:

- **Payment recording is still sequential writes, not one DB transaction**
  (installments → payment → balance → status, which can itself trigger
  distribution). Distribution and withdrawals *are* fully atomic in
  Postgres because double-distribution/double-withdrawal is a
  correctness bug, not just a UX nicety. Payment recording is lower risk
  (a crash mid-sequence leaves a visible, correctable inconsistency, not
  a silent double-payout) but could be moved into a
  `record_payment_with_allocation(...)` Postgres function for full
  belt-and-suspenders atomicity if you want it.
- **Payment-edit re-allocation**: editing a payment amount logs the audit
  trail and updates the record but doesn't re-run installment allocation
  — a deliberate choice (safely re-deriving historical allocation is its
  own hard problem), and it's blocked outright once a contract's profit
  has been distributed.
- **Outbox dependency resolution covers the client→contract case only.**
  If you outgrow the current online-only list in `lib/offline/guards.ts`
  and want, say, offline investor creation later, the same temp-ID
  pattern in `sync-engine.ts` extends to that case — it's not a rewrite,
  just adding another branch.
- **`/contracts/[id]` is read-stale offline.** Unlike `/clients` and
  `/contracts`, the contract detail page is server-rendered, not a
  Dexie-backed Client Component — so when served from the offline cache,
  the balance/installment/payment numbers shown are frozen at whatever
  they were the last time that exact page loaded online. Recording a
  payment from that stale page still works correctly (the dialog queues
  independently), and the amber "payments queued" banner exists
  specifically to flag that the displayed numbers haven't caught up yet
  — but turning this page into a fully reactive Dexie-backed view, the
  same way the list pages work now, is a real follow-up if that
  staleness ever causes confusion in practice.

---

## 6. Notes on Production Hardening

- **RLS**: any authenticated staff member (admin or partner) has full
  read/write on business tables — matches "only business partners can
  access the system." Partner-level row restrictions would be a policy
  change, not an app change, if you need that later.
- **Service role key**: must be set server-only in your deployment
  platform, never prefixed `NEXT_PUBLIC_`.
- **Service worker caching is shell-only by design** — see the
  Architecture section above for why API/data responses are deliberately
  excluded from the cache.
- **The offline cache window (500 clients/contracts, 1000 payments) is a
  tunable constant**, not a hard architectural limit — `getOfflineSnapshot()`
  in `lib/actions/offline-snapshot-actions.ts` is the only place that
  number lives if your dataset grows past what's comfortable to keep
  fully cached on a phone.
- **Investor deactivation is a soft status flag**, not a hard constraint
  — it doesn't affect existing investments/distributions, only warns
  when adding *new* investments for an inactive investor. One-line
  change in `upsertInvestorPhaseInvestment()` if you want it to actually
  block instead.

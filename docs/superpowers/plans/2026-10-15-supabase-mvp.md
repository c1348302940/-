# Supabase MVP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo identity and SQLite business store with Supabase Auth, Postgres, RLS, Realtime, account administration, and 12-month statistics while preserving existing workbench behavior.

**Architecture:** Keep the current vanilla frontend and Node server so the local Playwright hotspot collector remains available. The browser authenticates with Supabase and sends its JWT to the Node API; normal database work uses the caller JWT so RLS applies, while account administration uses a server-only secret key after an admin-role check. SQL migrations are the source of truth and start with one empty team.

**Tech Stack:** Node.js 24, vanilla ES modules, `@supabase/supabase-js`, Supabase Auth/Postgres/RLS/Realtime/Cron, Node test runner, Playwright.

**Spec:** `docs/supabase-mvp-spec.md`

## Global Constraints

- Do not migrate current SQLite demo rows.
- Support one team, one admin role, and member accounts created by the admin.
- Authenticate with username plus password. Map the normalized username to a confirmed, internal-only Supabase email identity; never expose the internal email in the UI.
- Never expose a Supabase secret/service-role key to the browser or source control.
- Preserve existing publishing, schedule-task synchronization, task-step, reminder, hotspot, and UI behavior.
- A member can only read and mutate their own tasks and steps; an admin can read the full team.
- Keep daily statistics for 12 months, using Asia/Shanghai dates.

## Review Focus

- A forged user ID in a request must not grant access; tests authenticate with two real JWT identities and assert isolation.
- A disabled account with an unexpired session must be rejected by profile checks and RLS.
- Concurrent updates must not duplicate schedule-generated tasks or daily snapshots; database uniqueness tests pin both cases.
- Deleting a referenced version must fail cleanly instead of leaving stale links.
- Published records with pending edits must continue returning the last published payload to members.

---

### Task 1: Supabase configuration and schema

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202610150001_initial_schema.sql`
- Create: `supabase/seed.sql`
- Create: `.env.example`
- Modify: `.gitignore`
- Test: `tools/test-schema-contract.mjs`

**Interfaces:**
- Produces all tables, constraints, helper functions, RLS policies, Realtime publication entries, and `take_daily_stats_snapshot()` used later.

- [ ] Write a schema contract test that asserts required tables, foreign keys, unique schedule-stage tasks, published payload fields, RLS enablement, and the daily snapshot uniqueness key.
- [ ] Run the contract test and verify it fails because migrations do not exist.
- [ ] Add the migration for profiles, team membership, versions, goals, milestones, schedules, selling points, tasks, steps, updates, reads, trends, saved topics, settings, and daily statistics.
- [ ] Add security-definer identity helpers with fixed `search_path`, least-privilege grants, and RLS policies from the spec.
- [ ] Add the daily snapshot function, 12-month cleanup, and a Supabase Cron schedule in Asia/Shanghai equivalent time.
- [ ] Run the contract test and SQL lint/validation until they pass.

### Task 2: Authentication and session boundary

**Files:**
- Create: `lib/supabase.js`
- Create: `public/js/auth.js`
- Create: `public/js/pages/login.js`
- Modify: `public/index.html`
- Modify: `public/js/main.js`
- Modify: `public/js/api.js`
- Modify: `public/js/shell.js`
- Modify: `public/styles.css`
- Modify: `server.js`
- Test: `tools/test-auth-boundary.mjs`

**Interfaces:**
- Produces `requireUser(req)`, `requireAdmin(req)`, `signIn(username, password)`, `signOut()`, and an authenticated API fetch wrapper.

- [ ] Write failing tests for missing JWT, forged body user ID, disabled profile, member/admin navigation, and username normalization.
- [ ] Implement environment validation and Supabase clients without logging secrets.
- [ ] Implement the username/password login screen, persisted session, logout, and removal of demo role switching.
- [ ] Make API identity derive only from the verified JWT and active profile.
- [ ] Run the focused tests, then the full existing verification suite.

### Task 3: Postgres state reader and mutation parity

**Files:**
- Create: `lib/supabase-store.js`
- Create: `lib/supabase-publish.js`
- Modify: `server.js`
- Modify: `public/js/api.js`
- Modify: `public/js/pages/mywork.js`
- Test: `tools/test-supabase-linkage.mjs`

**Interfaces:**
- Consumes authenticated identity and Task 1 schema.
- Produces the existing `/api/state` shape and `/api/mutate` actions backed by Supabase.

- [ ] Write failing integration tests for member isolation, admin visibility, goal progress, milestone completion, schedule-stage status, publish visibility, and step progress.
- [ ] Implement state reads with role-aware visibility and the current frontend response shape.
- [ ] Implement mutations with transactions/RPCs where multiple rows must change atomically.
- [ ] Add editable member-owned tasks with goal, version, and milestone associations; keep assigned-task fields admin-only.
- [ ] Verify deletion and version foreign-key behavior.
- [ ] Run focused integration tests and the full suite.

### Task 4: Admin account management

**Files:**
- Create: `lib/account-admin.js`
- Create: `public/js/pages/accounts.js`
- Modify: `server.js`
- Modify: `public/js/pages/admin.js`
- Modify: `public/js/shell.js`
- Test: `tools/test-account-admin.mjs`

**Interfaces:**
- Produces admin-only create, reset-password, disable, and restore endpoints.

- [ ] Write failing tests for member rejection, duplicate username, creation with a confirmed internal identity, password reset, disable, and history retention.
- [ ] Implement server-only Supabase Auth admin calls and matching profile updates.
- [ ] Add the account-management UI to 主营总台.
- [ ] Verify an inactive account cannot use an existing session and restored accounts can sign in again.
- [ ] Run focused tests and the full suite.

### Task 5: Realtime synchronization

**Files:**
- Create: `public/js/realtime.js`
- Modify: `public/js/main.js`
- Modify: `public/js/api.js`
- Modify: `public/js/pages/teamboard.js`
- Test: `tools/test-realtime-contract.mjs`

**Interfaces:**
- Produces a single debounced subscription that reloads visible state after authorized table changes.

- [ ] Write a failing contract test for subscribed tables, session cleanup, reconnection, and debounced reloads.
- [ ] Implement subscriptions for tasks, task steps, published content, users, and statistics.
- [ ] Keep manual refresh as a fallback and remove dependence on the 30-second team-board poll.
- [ ] Run focused tests and two-browser Playwright verification.

### Task 6: Current and historical statistics

**Files:**
- Create: `public/js/pages/statistics.js`
- Modify: `public/js/pages/dashboard.js`
- Modify: `public/js/pages/admin.js`
- Modify: `public/js/shell.js`
- Modify: `public/styles.css`
- Test: `tools/test-statistics.mjs`

**Interfaces:**
- Consumes daily snapshot rows and produces member-only and admin-filterable chart data.

- [ ] Write failing tests for totals, overdue logic, completion rate, member isolation, version filtering, idempotent daily snapshots, and 12-month cleanup.
- [ ] Implement current aggregate queries and historical snapshot reads.
- [ ] Add lightweight accessible trend charts to member and admin views.
- [ ] Run focused tests and visual Playwright checks at the current desktop viewport.

### Task 7: Hotspot upload and end-to-end verification

**Files:**
- Modify: `lib/hotspot.js`
- Modify: `server.js`
- Modify: `public/js/pages/hotspot.js`
- Modify: `README.md`
- Test: `tools/test-hotspot-sync.mjs`
- Test: `tools/verify-supabase-mvp.mjs`

**Interfaces:**
- Uploads only normalized hotspot results; local browser state and cookies never leave the admin machine.

- [ ] Write failing tests for admin-only collection, result upload, team read access, and absence of browser credentials in payloads.
- [ ] Route collection results to Supabase and preserve the existing headed login/search flow.
- [ ] Document local setup, Supabase variables, schema deployment, first-admin bootstrap, and future production deployment.
- [ ] Run auth, linkage, RLS, statistics, hotspot, full regression, and Playwright end-to-end verification from a clean database.

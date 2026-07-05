# AI Cashflow Copilot — development plan (completed)

Original plan date: 2026-07-04. All 9 stages below have since been completed
and deployed. This file is kept as a historical record of the plan and its
completion criteria. Day estimates are the original estimates, not actuals.

Architectural decisions (fixed early on, not revisited without a clear reason):

- One data model for both a solo user and a two-partner pair: an
  `organization` with 1..N members (`memberships`). Solo use is just an
  organization with a single owner.
- Roles: the `owner` can do everything; a `member` can freely delete only
  their own unverified records; deleting someone else's record, or a
  `verified` record, creates a delete request for the owner to approve.
- Delete permissions are enforced at the RLS layer in the database, not just
  in the UI — otherwise it's not real protection.

Each stage below has a "done when" criterion that can actually be checked,
rather than relying on "seems to work".

## Stage 1 — Data schema and RLS in Supabase (0.5–1 day) ✅ Done

Tables: `organizations` (id, name, currency, tax_rate), `memberships`
(org_id, user_id, role, share_percent, display_name), `transactions` (org_id,
created_by_user_id, date, amount, type, status, project, category, account,
description, receipt_path, locked_at), `delete_requests` (transaction_id,
requested_by, status).

RLS: rows are only visible if `auth.uid()` has a `memberships` row for that
`org_id`. UPDATE/DELETE on `transactions`: the owner can always; a member
only on their own, non-verified rows.

**Done when:** two test accounts in different organizations can't see each
other's data via a direct Supabase client query (not through the UI —
through the console/DevTools).

## Stage 2 — Real authentication (1–2 days) ✅ Done

Removed the Partner A / Partner B dropdown; added a real email/password login
screen. The "active users" list was replaced with the real list of
organization members from `memberships`.

**Done when:** closing and reopening the tab logs you back in as yourself —
you can't "become" the other partner through the UI.

## Stage 3 — Transactions: real storage (2–3 days) ✅ Done

Replaced `state.txs` (previously plain in-memory state, lost on refresh) with
insert/select/update/delete against Supabase, scoped to `org_id` and
`created_by_user_id`. Kept the existing render UI (`renderTxTable`,
`recalcPartnerBalances`) — only the data source changed.

**Done when:** a transaction added from one device/browser is visible to the
other partner on a different device after a page refresh.

## Stage 4 — Organization creation and partner invites (1–2 days) ✅ Done

Signing up automatically creates an `organization` + owner `membership`. An
"Invite partner" button generates a link carrying the `org_id`; opening it
signs the second user up as a member of that same organization.

**Done when:** the second partner sees the first partner's existing
transactions immediately after joining via the link.

## Stage 5 — Delete confirmation (1–2 days) ✅ Done

A member deleting someone else's transaction, or a verified one, creates a
`delete_request` instead of deleting directly. The owner sees the list of
requests and approves or rejects them.

**Done when:** a member's direct attempt to delete another user's row (via
the API, not just the button) is rejected by the database.

## Stage 6 — Real receipt storage (1–2 days) ✅ Done

Replaced saving files as base64/filename with uploads to a Supabase Storage
bucket, path shaped like `org_id/receipt_id.ext`. Bucket policy restricts
access to members of the same organization.

**Done when:** an uploaded receipt is visible to the partner from their own
device, and storage isn't bounded by the browser's localStorage limit.

## Stage 7 — Fix the tax reserve formula (0.5 day) ✅ Done

The reserve and distributable amounts were computed from two different bases
for the same percentage (`reserve = income * taxRate` vs.
`distributable = (income - expenses) * (1 - taxRate)`). Standardized on a
single model (reserve computed from net profit, not gross revenue) and
applied it consistently.

**Done when:** the reserve shown on the dashboard and the reserve implied by
the distributable calculation match exactly for the same set of
transactions.

## Stage 8 — Real Generate report / Lock month (1–2 days) ✅ Done

Replaced the `alert()` placeholders. "Generate report" produces a real
PDF/Excel export. "Lock month" sets a `locked_at` flag that blocks edits to
that month's transactions at the RLS layer, not just by graying out a
button.

**Done when:** after a month is locked, an attempt to edit one of its
transactions is rejected by the backend, not just hidden in the UI.

## Stage 9 — QA and release (1–2 days) ✅ Done

RLS tested with two real accounts. Checked on a mobile screen. Real code
committed to GitHub and deployed with real Supabase keys.

**Done when:** the repository has real commits with actual code (not just a
README + LICENSE), and the live URL requires a real login instead of a
dropdown.

## What shipped beyond the original plan

- Self-editable partner names (`memberships.display_name`) — each partner
  sets their own display name; the owner can't override it, but also can't
  be blocked from renaming themselves.
- Supabase Realtime subscription on `transactions`, so a transaction added by
  one partner appears for the other live, without a manual page refresh.
- Hosting migrated from Netlify to Cloudflare Pages after Netlify's account
  credits were exhausted. Live at https://ai-cashflow-copilot-v2.pages.dev

## Original estimate

9–15 working days for one developer working sequentially. Stages 1→2→3 are
strictly sequential (each depends on the previous); 4 and 6 can run in
parallel once 2–3 are done; stage 7 is independent and was the cheapest to
close at any point.

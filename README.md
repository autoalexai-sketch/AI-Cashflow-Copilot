# AI Cashflow Copilot

Shared cashflow & profit-split tool for small business partnerships —
projects, receipts, tax reserve, monthly close.

Live app: **https://ai-cashflow-copilot-v2.pages.dev**

## What it does

AI Cashflow Copilot is a lightweight, shared workspace for two business
partners (or a solo owner) to track cashflow together:

- **Transactions** — income, expenses, transfers, and partner draws, each
  tagged with an account (bank / cash / tax reserve), a project, and a
  category.
- **Partner balances** — earned share, withdrawn draws, and remaining
  balance per partner, computed from a configurable share split (default
  50/50).
- **Projects** — group transactions by job/project to see which one is
  actually profitable.
- **Receipts** — attach a photo or file to any transaction, stored privately
  per organization.
- **Tax reserve** — a configurable percentage automatically set aside from
  net profit.
- **Monthly close** — generate a report, then lock the month so no further
  edits can be made to it (enforced in the database, not just the UI).
- **Partner invites** — the workspace owner generates a one-time invite
  link; whoever opens it and signs up joins the same shared workspace
  instead of creating their own.
- **Live sync** — a transaction added by one partner appears for the other
  in real time, no page refresh required.
- **Self-editable partner names** — each partner sets their own display
  name; nobody can rename the other partner.

## Roles & permissions

- **Owner** — full control: can edit the tax rate, lock/unlock months,
  approve or reject delete requests, and delete any transaction directly.
- **Member** — can freely delete their own unverified transactions. Deleting
  someone else's transaction, or a transaction that's already `verified`,
  creates a **delete request** that the owner must approve.

All of the above is enforced with Postgres Row-Level Security policies on
the Supabase database — not just hidden/disabled in the UI. A member calling
the API directly (bypassing the UI entirely) still can't do anything their
role doesn't allow.

## Tech stack

- **Frontend:** single self-contained `index.html` (vanilla JS, no build
  step).
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth, Storage
  (receipts bucket), and Realtime (live transaction sync).
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com) (static,
  Direct Upload deploys).

## Repository layout

| File | Purpose |
|---|---|
| `index.html` | The full app — UI + Supabase client logic. This is the file that gets deployed as-is. |
| `supabase_001_schema_and_rls.sql` | Base schema and RLS policies (tables, roles, base security model). |
| `MIGRATIONS_LOG.md` | Ordered log of every migration applied on top of the base schema, with what each one fixed or added. |
| `DEVELOPMENT_PLAN.md` | The original stage-by-stage build plan, with each stage's "done when" criterion and completion status. |

## Database

The live schema lives in Supabase project `bgbcyncpdfnsrhvunzkv`. To
reproduce it locally or in a new environment:

1. Apply `supabase_001_schema_and_rls.sql` for the base schema and RLS.
2. Apply the migrations listed in `MIGRATIONS_LOG.md`, in order.

Row-Level Security is central to this project's security model: every table
(`organizations`, `memberships`, `transactions`, `delete_requests`,
`locked_months`, `projects`, `invites`) has explicit RLS policies for
SELECT/INSERT/UPDATE/DELETE. A missing policy silently no-ops writes rather
than erroring, so any new table or column needs its own explicit policy —
don't assume "it has SELECT so it must be fine".

## Deployment

The app is a single static `index.html` with no build step. Deploying means
uploading that one file (as a zip) via Cloudflare Pages' Direct Upload flow
to the `ai-cashflow-copilot-v2` project. Supabase URL/key are embedded in the
client as the anon (publishable) key, which is safe to expose — all real
access control happens via RLS on the server side.

## Status

All 9 stages of the original development plan are complete (see
`DEVELOPMENT_PLAN.md`), plus the following added afterward:

- Self-editable partner display names.
- Realtime transaction sync between partners.
- Migration of hosting from Netlify to Cloudflare Pages.

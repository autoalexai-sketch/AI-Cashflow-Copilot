# SplitBooks

_(Originally built under the working name "AI Cashflow Copilot"; renamed to SplitBooks in July 2026.)_

Shared cashflow & profit-split tool for small business partnerships —
projects, receipts, tax reserve, monthly close.

Live app: **https://splitbooks.pl** · **https://splitbooks.eu**

Legal: [Privacy Policy](https://splitbooks.pl/privacy.html) · [Terms of Use](https://splitbooks.pl/terms.html) (templates — see "Legal pages" below before relying on them publicly)

## What it does

SplitBooks is a lightweight, shared workspace for two business
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

- **Frontend:** single self-contained `splitbooks.html`
  (vanilla JS, no build step). This is the exact file uploaded to Netlify
  as `index.html` on deploy.
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth, Storage
  (receipts bucket), and Realtime (live transaction sync).
- **Hosting:** [Netlify](https://www.netlify.com) (static, manual
  Netlify Drop deploys — no git integration, no build step), with custom
  domains `splitbooks.pl` and `splitbooks.eu` (registered at home.pl, DNS
  managed via Netlify).

## Legal pages

`privacy.html` and `terms.html` are deployed alongside `index.html` and
linked from the app's footer. They are **starting templates**, not
lawyer-reviewed documents — they include an explicit "not financial, tax,
investment, or legal advice" disclaimer and a "not a payment
institution/processor" statement, but still have bracketed placeholders
(`[contact email]`, `[Supabase project region]`, `[country]`) that need to
be filled in, and should be reviewed by a lawyer (GDPR applies given the
Poland/EU user base) before being treated as final.

## Repository layout

| File | Purpose |
|---|---|
| `splitbooks.html` | The full app — UI + Supabase client logic. Deployed to Netlify as-is (renamed to `index.html` at deploy time). |
| `privacy.html` | Privacy Policy (EN + PL), linked from the app footer. Template — see "Legal pages" above. |
| `terms.html` | Terms of Use, including the "not financial/legal/tax advice" and "not a payment institution" disclaimers (EN + PL). Template — see "Legal pages" above. |
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

The app is a single static HTML file with no build step. Deploying means
copying `splitbooks.html` to `index.html` and dragging the full site
folder (`index.html`, `privacy.html`, `terms.html`, `pricing.html`,
`help.html`, and the supporting static assets) onto Netlify Drop
(https://app.netlify.com/projects/mellifluous-kitten-92626e/deploys).
Netlify Drop deploys are not incremental — every file in the site must be
included in each drop, not just the ones that changed. Supabase URL/key
are embedded in the client as the anon (publishable) key, which is safe to
expose — all real access control happens via RLS on the server side.

## Status

All 9 stages of the original development plan are complete (see
`DEVELOPMENT_PLAN.md`), plus the following added afterward:

- Self-editable partner display names.
- Realtime transaction sync between partners.
- Migrated hosting from Cloudflare Pages back to Netlify (current live
  host — Cloudflare Pages was found out of sync with the domains' actual
  DNS records).
- Renamed the project to SplitBooks; connected custom domains
  `splitbooks.pl` and `splitbooks.eu`.
- Added Privacy Policy and Terms of Use pages, plus an in-app footer
  disclaimer (EN/PL/UK) stating SplitBooks is not financial, tax,
  investment, or legal advice, and not a payment institution.

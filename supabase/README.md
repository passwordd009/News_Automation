# Supabase schema

The single source of truth for the database. Both the Python worker and the
Next.js app read this schema; nothing should be changed through the dashboard
without a matching migration here.

```
migrations/
  20260913000001_initial_schema.sql   tables, constraints, indexes, triggers
  20260913000002_rls_policies.sql     Row Level Security
seed_admin.sql                        one-time first-admin promotion
tests/
  shim_local_auth.sql                 stands in for Supabase locally
  rls_test.sql                        policy assertions, per role
  run_local_rls_tests.sh              throwaway cluster + full run
```

## Testing policies before they ship

RLS is the only thing actually stopping an unauthorized write — §17 is explicit
that hiding a button is not security. So the policies are tested rather than
reviewed by eye:

```bash
./supabase/tests/run_local_rls_tests.sh
```

This starts a throwaway PostgreSQL 16 cluster, shims the pieces Supabase
normally provides (the `auth` schema, `auth.uid()`, and the `anon`,
`authenticated` and `service_role` roles), applies the real migration files,
and exercises each policy while acting as a genuine Postgres role with a real
`auth.uid()`. Any failed assertion aborts the run.

32 assertions currently pass, covering all three roles:

- a Content Creator cannot see the pending queue, approve, decline, edit
  editorial fields, promote themselves, file a request as someone else, or
  resolve their own request
- an Approver can review and decide, but cannot change anyone's role
- decisions are stamped from the session's own identity, so one reviewer
  cannot record a decision under another's name
- only one weekly period is active at a time, and closing one preserves its
  articles

Needs the PostgreSQL 16 server binaries (`postgresql-16` on Debian/Ubuntu).
Supabase itself is not required.

## Applying to your project

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Then sign up through the app and run `seed_admin.sql` once, with your email
substituted.

## Design notes

**The AI never approves.** The worker writes `ai_recommended` and the scores;
`status` always starts at `pending`. Only `articles_update_reviewer` can move an
article to `approved`, and that policy requires an admin or approver.

**Content Creators never hold UPDATE on articles.** Requesting reconsideration
is an INSERT into `approval_requests`; a trigger moves the article into the
reviewers' queue. So the reconsideration flow works without granting write
access to the article itself.

**Decision audit columns are stamped by trigger,** not by the client. Sending
someone else's id as `approved_by` is overwritten with `auth.uid()`.

**Declines are never overwritten.** Reconsideration lives in its own table, so
the original decline and its reversal both stay auditable.

**Weekly periods rotate atomically** via `rotate_weekly_period(start, end)`,
which closes the current period and opens the next in one transaction. Inserting
a new active period without closing the old one violates the single-active index
by design.

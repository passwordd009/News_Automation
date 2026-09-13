# Project Hestia Weekly Wrap-Up — Supabase Editorial CMS Specification

## 1. Purpose of this document

This document replaces the previous Google-Docs-first architecture for Project Hestia's Weekly Wrap-Up news workflow.

Claude Code should treat this document as the current source of truth for the product direction.

**The old approach is deprecated:**

```text
Fetch news -> LLM -> JSON -> Google Doc -> manual review
```

**The new approach is:**

```text
News sources
    -> Python ingestion + AI screening
    -> Supabase database
    -> Role-based Hestia editorial dashboard
    -> Human approval / decline workflow
    -> Weekly approved-content archive
    -> Optional export later (Google Docs, social copy, etc.)
```

Google Docs is no longer the main workspace, database, or approval interface. If Google Docs is reintroduced later, it should be an optional export after human review.

---

## 2. Product goal

Project Hestia publishes a weekly Instagram "Weekly Wrap-Up" to help New Yorkers learn about useful, informative, community-focused, positive, or locally relevant events and developments from the previous week.

The software should reduce the manual work involved in:

1. Finding articles every day.
2. Screening them for relevance to New Yorkers.
3. Summarizing and categorizing them.
4. Reviewing whether they should be included.
5. Preserving approved stories by weekly period.
6. Giving content creators a clean place to access material for Instagram production.

The application is an **editorial content management system**, not an automatic publishing system.

No article should be published to Instagram automatically.

---

# 3. Core architecture

## Technology

### Frontend
- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase JS client

### Backend / database
- Supabase Postgres
- Supabase Auth
- Supabase Row Level Security (RLS)

### News ingestion
- Python 3.12+
- RSS initially
- Gmail newsletters later
- Optional news/search API later

### AI screening
- Python worker
- LLM provider must be abstracted
- Prefer free/local model support such as Ollama initially

### Scheduling
Later support:
- cron
- GitHub Actions
- or another scheduled worker

---

# 4. System overview

```text
                   NEWS SOURCES
             RSS / Gmail / News API
                       |
                       v
               PYTHON NEWS WORKER
               ------------------
               Fetch
               Normalize
               Deduplicate
               Extract content
               AI review
               Score
                       |
                       v
                   SUPABASE
            ----------------------
            articles
            weekly_periods
            profiles
            approval_requests
                       |
                       v
              NEXT.JS DASHBOARD

       +-------------+-------------+
       |             |             |
       v             v             v
     Review        Approved      Declined
       |             |             |
  Approve/Decline    |        Request review
       |             |             |
       +-------------+-------------+
                     |
                     v
                 WEEK ARCHIVE
```

The Python worker and Next.js application should remain separate concerns.

Python discovers and evaluates content.

Next.js is responsible for the human editorial workflow.

Supabase is the shared source of truth.

---

# 5. User roles

The application has three roles:

```text
admin
approver
content_creator
```

Roles should live in a `profiles` table linked one-to-one with `auth.users`.

## Admin

Admin has full access.

Admin can:
- View pending articles.
- Approve articles.
- Decline articles.
- View approved content.
- View declined content.
- Review reconsideration requests.
- Edit article metadata/editorial text.
- Manage weekly periods.
- Access archived weeks.
- Perform administrative actions.

## Approver

Approver is responsible for editorial decisions.

Approver can:
- View pending articles.
- Approve articles.
- Decline articles.
- View approved content.
- View declined content.
- Review reconsideration requests.
- Edit article editorial fields when necessary.
- Access current and previous approved weeks.

Approver should not automatically have unrelated administrative controls.

## Content Creator

Content Creator uses approved content to produce Hestia's Instagram Weekly Wrap-Up.

Content Creator can:
- View approved articles.
- View current approved week.
- View previous approved weeks.
- View declined articles.
- Request that a declined article be reconsidered.
- Add a reason when requesting reconsideration.

Content Creator **cannot**:
- Approve an article directly.
- Decline an article directly.
- Change their own role.
- Bypass editorial review.

---

# 6. Authorization matrix

| Capability | Admin | Approver | Content Creator |
|---|---:|---:|---:|
| View pending queue | Yes | Yes | No |
| Approve article | Yes | Yes | No |
| Decline article | Yes | Yes | No |
| View approved articles | Yes | Yes | Yes |
| View archived approved weeks | Yes | Yes | Yes |
| View declined articles | Yes | Yes | Yes |
| Request reconsideration | Yes | Optional | Yes |
| Resolve reconsideration request | Yes | Yes | No |
| Edit editorial article fields | Yes | Yes | Limited/No initially |
| Manage user roles | Yes | No | No |
| Manage weekly periods | Yes | Optional later | No |

Authorization must exist at **both** layers:

1. Frontend route/button protection.
2. Supabase Row Level Security.

Hiding a button is not sufficient security.

---

# 7. Weekly period model

The application organizes content by a weekly editorial period.

Example:

```text
September 7, 2026 - September 13, 2026
```

Each article belongs to the weekly period in which it was collected/reviewed.

Approved articles must remain permanently associated with that period after the week closes.

Suggested table:

```text
weekly_periods
---------------------------------
id UUID primary key
start_date DATE
end_date DATE
status TEXT
created_at TIMESTAMPTZ
closed_at TIMESTAMPTZ nullable
```

Suggested status values:

```text
active
closed
```

Only one weekly period should normally be `active` at a time.

When the current period ends:

1. Mark the existing period `closed`.
2. Preserve all approved articles in that period.
3. Create the next active period.
4. New articles are associated with the new period.

Previous weeks must remain accessible using the same approved-content UI as the current week.

---

# 8. Article lifecycle

Suggested article statuses:

```text
pending
approved
declined
reconsideration_requested
```

Optional future statuses:

```text
published
archived
```

Typical lifecycle:

```text
Python fetches article
        |
        v
     pending
      /   \
     /     \
 approve  decline
   |         |
   v         v
approved   declined
              |
              | content creator requests review
              v
    reconsideration_requested
          /        \
         /          \
    approve       keep declined
       |               |
       v               v
   approved         declined
```

---

# 9. Declined article retention

Do **not** use browser cache or Redis as the primary home for declined articles.

Declined stories should remain temporarily in Supabase.

Suggested fields:

```text
declined_at
 declined_by
 delete_after
```

Example policy:

- A declined article remains accessible for the rest of its weekly editorial period.
- Content Creators can see it and request reconsideration.
- After the period is closed and the reconsideration window has passed, it may be deleted by a cleanup job.

Important:

Do not permanently delete a declined article before the Content Creator has had a reasonable chance to request reconsideration.

The exact deletion policy should be configurable rather than deeply hardcoded.

---

# 10. Article database model

Suggested `articles` table:

```text
articles
--------------------------------------------------
id UUID primary key
weekly_period_id UUID references weekly_periods(id)

# Source data
title TEXT not null
url TEXT not null
normalized_url TEXT
source TEXT
source_type TEXT
published_at TIMESTAMPTZ
fetched_at TIMESTAMPTZ
raw_description TEXT
article_text TEXT

# AI/editorial data
topic TEXT
borough TEXT
description TEXT
why_post TEXT

nyc_relevance_score NUMERIC
informative_score NUMERIC
community_value_score NUMERIC
positivity_score NUMERIC
local_event_score NUMERIC
credibility_score NUMERIC
overall_score NUMERIC

ai_recommended BOOLEAN
ai_rejection_reason TEXT

# Workflow
status TEXT not null default 'pending'

approved_by UUID nullable references profiles(id)
approved_at TIMESTAMPTZ nullable

declined_by UUID nullable references profiles(id)
declined_at TIMESTAMPTZ nullable
decline_reason TEXT nullable
delete_after TIMESTAMPTZ nullable

created_at TIMESTAMPTZ default now()
updated_at TIMESTAMPTZ default now()
```

Add indexes for common queries, especially:

```text
weekly_period_id
status
created_at
normalized_url
```

The normalized article URL should be unique when practical to reduce duplicate ingestion.

---

# 11. Reconsideration requests

Use a separate table instead of overwriting the decline decision.

```text
approval_requests
--------------------------------------------------
id UUID primary key
article_id UUID references articles(id)
requested_by UUID references profiles(id)
reason TEXT
status TEXT
created_at TIMESTAMPTZ
resolved_at TIMESTAMPTZ nullable
resolved_by UUID nullable references profiles(id)
resolution_note TEXT nullable
```

Suggested statuses:

```text
pending
approved
rejected
```

When a Content Creator clicks **Request Approval**:

1. Require or strongly encourage a short reason.
2. Insert an `approval_requests` row.
3. Change article status to `reconsideration_requested`.
4. Surface the story in the Approver/Admin queue.

Approver/Admin can then:

```text
Approve
Keep Declined
```

The original decline and the reconsideration decision should remain auditable.

---

# 12. Profiles and authentication

Suggested table:

```text
profiles
---------------------------------
id UUID primary key references auth.users(id)
email TEXT
full_name TEXT
role TEXT not null
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
```

Allowed role values:

```text
admin
approver
content_creator
```

Do not trust a client-supplied role.

The logged-in user's role should be loaded from Supabase and permissions enforced with RLS.

---

# 13. Application pages

Suggested routes:

```text
/login

/dashboard
/review
/approved
/declined
/archive
/archive/[periodId]
```

Potential admin routes later:

```text
/admin/users
/admin/settings
```

## `/review`

Authorized:

```text
admin
approver
```

Purpose:

View articles awaiting editorial decision.

Each article should show enough information to make a decision without opening multiple screens.

Suggested article card:

```text
+---------------------------------------------------------+
| EDUCATION                                               |
|                                                         |
| NYC expands free after-school programs                  |
|                                                         |
| Source: THE CITY             Score: 8.9                 |
| Published: Sep 10, 2026                                 |
|                                                         |
| NYC Relevance       10/10                               |
| Informative          9/10                               |
| Community Value      9/10                               |
| Credibility          9/10                               |
| Positivity           7/10                               |
|                                                         |
| Description                                             |
| ...                                                     |
|                                                         |
| Why Post                                                |
| ...                                                     |
|                                                         |
| [Open Source]              [Decline] [Approve]          |
+---------------------------------------------------------+
```

Approver/Admin should eventually be able to edit:

- Topic
- Description
- Why Post

before or after approval.

## `/approved`

Authorized:

```text
admin
approver
content_creator
```

The weekly period must be visually prominent near the top.

Example:

```text
WEEKLY WRAP-UP
September 7 - September 13, 2026
```

Approved articles should appear **in one vertical line/feed**, not a dense multi-column grid.

Users scroll down to see every approved article for the week.

Example:

```text
WEEKLY WRAP-UP
SEP 7 - SEP 13

+--------------------------------------------------+
| Education                                        |
| NYC expands...                                   |
| Description...                                   |
| Why Post...                                      |
| Source                                           |
+--------------------------------------------------+

+--------------------------------------------------+
| Affordable Housing                               |
| Housing lottery...                               |
| Description...                                   |
| Why Post...                                      |
+--------------------------------------------------+

        scroll down for more
```

The same component/layout must be used for historical weeks.

Do not build a completely different archive article design.

## `/archive`

Authorized:

```text
admin
approver
content_creator
```

Shows previous periods.

Example:

```text
Weekly Wrap-Up Archive

Sep 7 - Sep 13        6 approved stories
Aug 31 - Sep 6        8 approved stories
Aug 24 - Aug 30       5 approved stories
```

Clicking a period opens:

```text
/archive/[periodId]
```

That page should reuse the same weekly approved list component used on `/approved`.

## `/declined`

Authorized:

```text
admin
approver
content_creator
```

Display declined articles for the relevant week.

Content Creators should see a button:

```text
Request Approval
```

Example:

```text
Affordable Housing

NYC housing proposal receives...

Reason declined:
Too similar to another selected article.

[Open Article]                 [Request Approval]
```

For Approver/Admin, show appropriate editorial controls instead.

---

# 14. Reconsideration UI

When Content Creator presses `Request Approval`, open a modal or form:

```text
Request Article Reconsideration

Why should this article be reviewed again?

[                                                  ]
[                                                  ]
[                                                  ]

[Cancel]                         [Submit Request]
```

After submission:

- Article shows `Reconsideration Requested`.
- Request becomes visible to Admin/Approver.
- Prevent duplicate pending requests for the same article/user unless specifically required.

Approver view:

```text
RECONSIDERATION REQUESTED

Article title...

Originally declined by: ...
Original reason: ...

Requested by: ...
Reason:
"This story contains additional tenant information..."

[Keep Declined]                       [Approve]
```

---

# 15. UI / visual design direction

Project Hestia's interface should feel clean, editorial, modern, and easy to scan.

## Main visual rule

**Orange should be the primary accent and outline color.**

Use orange for:

- borders/outlines
- buttons
- active navigation states
- section markers
- article card accents
- focus states
- weekly-period emphasis

Do not make the entire interface solid orange.

The background can remain neutral/light or dark depending on implementation, but orange should make the Hestia identity obvious.

Suggested concept:

```text
+======================================================+
| WEEKLY WRAP-UP                                       |
| September 7 - September 13                           |
+======================================================+

     orange rules / borders / active accents
```

## Approved article layout

Approved content should be a vertically scrolling editorial feed.

Prioritize:

1. Topic
2. Article title
3. Description
4. Why Post
5. Source/link

Avoid small cards arranged three or four across.

The content creator should be able to comfortably read the week's entire editorial package from top to bottom.

---

# 16. Navigation

Navigation visibility may depend on role.

Example for Admin/Approver:

```text
Review
Approved
Declined
Archive
```

Example for Content Creator:

```text
Approved
Declined
Archive
```

Admin may later receive:

```text
Users
Settings
```

Do not expose routes merely by hiding links. Protected routes must verify authentication and authorization server-side where appropriate.

---

# 17. Supabase Row Level Security requirements

RLS is mandatory.

At minimum, policies should enforce the following behavior.

## Content Creator

Can:
- SELECT approved articles.
- SELECT declined articles they are allowed to review.
- SELECT weekly periods.
- INSERT approval requests as themselves.
- SELECT relevant approval requests.

Cannot:
- Set an article to `approved`.
- Set an article to `declined`.
- Change `approved_by` or `declined_by`.
- Change their role.

## Approver

Can:
- SELECT editorial article records.
- UPDATE editorial fields.
- Approve/decline articles.
- Read and resolve approval requests.
- Read weekly periods.

## Admin

Can perform full application operations.

Claude should not implement insecure logic like:

```ts
if (user.role === 'content_creator') hideApproveButton()
```

while leaving the database update unrestricted.

UI authorization and database authorization are both required.

---

# 18. Python ingestion behavior

The news ingestion pipeline remains useful and should write directly to Supabase instead of generating a Google Doc.

New flow:

```text
RSS / Gmail / API
       |
       v
Python fetcher
       |
       v
Normalize
       |
       v
Deduplicate
       |
       v
LLM review
       |
       v
Create article in Supabase
status = pending
weekly_period_id = current active period
       |
       v
Human review in Next.js
```

The Python worker should **not** directly set an article to human-approved status.

AI output can produce:

```text
ai_recommended = true/false
overall_score
summary
why_post
topic
etc.
```

But human approval remains separate.

---

# 19. AI article evaluation

The AI should prioritize usefulness rather than only positivity.

Suggested scoring:

```text
NYC relevance       30%
Community value     25%
Informative value   20%
Credibility         15%
Positivity           5%
Local event value    5%
```

High-value examples:

- affordable housing opportunities
- education developments
- youth programs
- community events
- grants
- small-business resources
- transportation updates
- public benefits
- local health resources
- neighborhood improvements
- arts and culture
- nonprofit/community initiatives

Generally deprioritize:

- violent crime reporting without broader community value
- celebrity gossip
- ragebait
- rumors
- national political stories without a meaningful NYC connection
- sensational stories
- repetitive coverage of the same event

The AI provides recommendations. Humans make final editorial decisions.

---

# 20. Duplicate handling

At minimum:

1. Normalize URLs.
2. Reject exact duplicate URLs.
3. Compare normalized/similar headlines.

Potential future enhancement:

```text
story_group_id
```

This could group multiple publications covering the same underlying story.

Example:

```text
NYC launches youth jobs initiative

5 sources found
Recommended: THE CITY
Also covered by:
- Gothamist
- AMNY
- NY1
- City Limits
```

Do not over-engineer story grouping in the first implementation.

---

# 21. Current Google Docs status

The previous implementation attempted to take fetched JSON and create a Google Doc.

That workflow should now be considered **legacy/deprecated**.

Claude should:

1. Identify Google Docs-specific code in the project.
2. Avoid extending that workflow.
3. Remove or isolate Google Docs generation when doing so is safe.
4. Preserve reusable article fetching, scoring, and parsing logic.
5. Redirect persistence to Supabase.

Do **not** blindly delete working ingestion code simply because it currently feeds Google Docs.

Separate reusable logic from obsolete output logic.

Future optional feature:

```text
Approved weekly period
        |
        v
Export
   +----+----------------+
   |                     |
Google Doc          Instagram copy
```

But export is not part of the first Supabase/UI migration.

---

# 22. Migration strategy

Claude should migrate incrementally.

## Phase 1 - Inspect current repository

Before modifying code:

- Identify Python ingestion files.
- Identify existing JSON article schema.
- Identify Google Docs writer/generator code.
- Identify existing frontend, if any.
- Identify Supabase setup, if any.
- Identify environment variables.

Produce a concise migration plan based on the actual repository.

Do not assume the repository matches this document exactly.

## Phase 2 - Supabase schema

Create:

- `profiles`
- `weekly_periods`
- `articles`
- `approval_requests`

Create enums/check constraints where appropriate.

Add indexes.

Add RLS policies.

Provide migrations rather than relying only on manual dashboard changes.

## Phase 3 - Authentication + roles

Implement:

- Login
- Auth session handling
- Profile lookup
- Role-aware navigation
- Route guards
- RLS verification

Create a safe method for assigning the first admin.

## Phase 4 - Move ingestion persistence

Modify Python pipeline:

```text
Before:
article JSON -> Google Docs

After:
article JSON -> Supabase articles table
```

New records should default to:

```text
status = pending
```

Assign current active `weekly_period_id`.

## Phase 5 - Review page

Build Admin/Approver review queue.

Implement:

- article display
- source link
- AI scores
- description
- why post
- approve action
- decline action
- optional decline reason

## Phase 6 - Approved feed

Build approved page.

Requirements:

- weekly period prominently displayed
- vertical scroll
- all approved articles for the week
- clean orange-accented design

## Phase 7 - Archive

Build previous-week selector/list.

Reuse approved feed component for archived periods.

## Phase 8 - Declined + reconsideration

Build declined page.

Content Creator can request approval.

Admin/Approver can resolve requests.

## Phase 9 - Cleanup job

Add safe cleanup behavior for expired declined content.

Do not delete declined records with unresolved reconsideration requests.

## Phase 10 - Optional exports

Only after the editorial application is stable consider:

- Google Docs export
- Instagram copy export
- PDF export

---

# 23. Suggested frontend component structure

Example only; adjust based on repository conventions.

```text
app/
  login/
    page.tsx

  (protected)/
    layout.tsx

    review/
      page.tsx

    approved/
      page.tsx

    declined/
      page.tsx

    archive/
      page.tsx
      [periodId]/
        page.tsx

components/
  navigation/
    AppSidebar.tsx

  weekly/
    WeeklyPeriodHeader.tsx
    WeeklyArticleList.tsx

  articles/
    ReviewArticleCard.tsx
    ApprovedArticleCard.tsx
    DeclinedArticleCard.tsx
    ArticleScores.tsx
    ArticleEditorialFields.tsx

  approvals/
    RequestReconsiderationDialog.tsx
    ReconsiderationCard.tsx

lib/
  supabase/
    client.ts
    server.ts
    middleware.ts

  auth/
    permissions.ts
    getCurrentProfile.ts

  articles/
    queries.ts
    mutations.ts
```

Do not force this structure if the existing repository already has strong conventions.

---

# 24. Important product rules

1. Supabase is the source of truth.
2. Google Docs is not the approval workspace anymore.
3. Every article belongs to a weekly period.
4. Approved articles are preserved with their historical week.
5. Current and previous approved weeks share the same UI format.
6. Approved articles display in a vertical scrolling feed.
7. Orange is the primary visual accent/outline color.
8. Only Admin and Approver can make approval decisions.
9. Content Creator can view approved and declined stories.
10. Content Creator can request reconsideration of declined stories.
11. Reconsideration must go back to an Approver/Admin.
12. Declined content should not disappear immediately.
13. Authorization must be enforced in Supabase RLS, not just UI logic.
14. AI recommendations do not equal human approval.
15. Do not auto-publish to Instagram.
16. Preserve useful existing ingestion code during migration.
17. Do not rebuild the deprecated Google Docs workflow.

---

# 25. Definition of done for the first major milestone

The migration's first major milestone is complete when:

1. Users can log in.
2. Users have Admin, Approver, or Content Creator roles.
3. Python can insert fetched/AI-reviewed articles into Supabase.
4. Inserted articles appear in an Admin/Approver review queue.
5. Admin/Approver can approve or decline them.
6. Approved articles appear under the correct weekly period.
7. Content Creator can view approved content.
8. Current approved content appears in a vertically scrolling feed.
9. Previous weeks can be opened and use the same approved article layout.
10. Content Creator can view declined content.
11. Content Creator can request reconsideration.
12. Approver/Admin can resolve reconsideration requests.
13. Supabase RLS prevents unauthorized approval/decline actions.
14. Google Docs generation is no longer required for the editorial workflow.

---

# 26. Claude Code instructions

When using this document:

- Treat it as the desired product behavior.
- First inspect the existing repository before implementing changes.
- Do not rewrite working code unnecessarily.
- Reuse existing Supabase, Next.js, Python, and article-processing code when possible.
- Prefer migrations and typed models over one-off manual database setup.
- Keep business logic centralized rather than duplicating role checks everywhere.
- Verify RLS behavior with each role.
- Build the migration in small, testable phases.
- After each phase, summarize what changed and what remains.

## First task for Claude

Start by inspecting the repository and answer these questions before making broad changes:

1. Where is news currently fetched?
2. What is the current article JSON structure?
3. Where is the Google Docs generation implemented?
4. Is Supabase already configured?
5. Is a Next.js frontend already present?
6. What authentication code currently exists?
7. What portions of the existing implementation can be reused?
8. What files need to be deprecated, replaced, or refactored?

Then propose the smallest safe migration plan to move from:

```text
JSON -> Google Docs
```

to:

```text
Python -> Supabase -> Role-based editorial UI
```

Do not begin by rebuilding the entire application from scratch.

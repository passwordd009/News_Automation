# Legacy — the Google Docs workflow

Superseded by the Supabase editorial CMS. Isolated here rather than deleted,
per §21 of the CMS spec: *"Do not blindly delete working ingestion code simply
because it currently feeds Google Docs. Separate reusable logic from obsolete
output logic."*

Nothing in `app/` imports anything in this directory.

## What is here and why it was retired

| File | Why |
|---|---|
| `google/document_builder.py` | Rendered the Wrap-Up text layout. The dashboard is the workspace now. |
| `google/docs_writer.py` | Uploaded that layout to Google Docs. |
| `generate_weekly_doc.py` | The old main command. Replaced by `scripts/ingest.py`. |
| `weekly_pipeline.py` | **Obsolete by design.** It algorithmically selected 5–10 articles with topic diversity — the job humans now do in `/review`. |

`weekly_pipeline.py` is the interesting one. It was not Google-specific and it
worked, but automated selection actively conflicts with the new architecture:
anything it filtered out would never reach the reviewers who are supposed to
decide.

## What moved out of here, not into it

The ingestion core was kept and is still live in `app/`: the collectors, URL
normalization, deduplication, the Pydantic schemas and the scoring weights.
Only the output layer was retired.

## Its tests still run

`legacy/test_weekly_doc.py` passes (16 tests). It stays green so this code
remains a working reference if the optional Google Docs *export* in §21 is ever
built on top of approved content:

```bash
cd worker && pytest legacy/ -q
```

## Deleting it

Safe once the CMS has produced a Weekly Wrap-Up end to end and nobody wants the
export. Until then it costs nothing and answers "how did the old format look?"

The SQLite layer in `app/database/` (`models.py`, `database.py`,
`repository.py`) is also legacy in practice — only this workflow and
`scripts/collect_articles.py` still use it. It was left in place because
removing it is a larger change than isolating the output layer, and the
principle for this migration is the smallest safe step.

-- Level 2 deduplication support (§20.3).
--
-- normalized_url already blocks the same link twice. This catches the same
-- story published under near-identical headlines by different outlets, which a
-- URL comparison cannot see.
--
-- The fingerprint is computed by the worker (app/processing/deduplicator.py):
-- the headline's significant words, lowercased, accent-folded, stopwords
-- removed, sorted and hashed — so word order and filler do not matter.

alter table public.articles
  add column if not exists title_fingerprint text;

create index if not exists articles_title_fingerprint_idx
  on public.articles (title_fingerprint)
  where title_fingerprint is not null;

comment on column public.articles.title_fingerprint is
  'Order-independent hash of the headline''s significant words. Used to detect '
  'the same story covered by multiple outlets. Deliberately not unique: a '
  'collision should be reviewed, not silently rejected at the database layer.';

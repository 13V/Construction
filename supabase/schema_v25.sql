-- Crewline schema v25 — a job's colour is a fact about the job.
--
-- The Simple design gives every job a rail colour, picked when the job is
-- created (the New project form draws a swatch row), and then uses it
-- everywhere the job appears: the edge of its cards, its calendar rows, its
-- progress bar, its chat tile. Until now the app derived a colour by hashing
-- the site id — stable, but nobody chose it, and it can never match what the
-- design (or an office) intends. A chosen colour is data, so it gets a column.
--
-- Nullable on purpose: a job with no chosen colour falls back to the hash,
-- so nothing breaks and nothing needs backfilling.

alter table job_sites add column if not exists colour text;

comment on column job_sites.colour is
  'The job''s rail colour (hex), chosen at creation. Null falls back to a hash-derived colour.';

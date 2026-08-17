-- Crewline schema v29 — the paperwork behind a scope line.
--
-- "All of them would require to have multiple uploads and attach PDF." A
-- confirmed tile selection is a sentence plus its evidence: the supplier's
-- data sheet, the photo of the sample board, the builder's marked-up
-- schedule. So a scope line gets files, and files already have a home.
--
-- site_files carries storage_path, name, mime, size_bytes, uploaded_by and the
-- storage RLS that keeps a company inside its own folder. Pointing a row at a
-- selection is one column, against a new parallel table that would duplicate
-- all of it.
--
-- Scope attachments are filed as kind='document', which is what keeps them out
-- of the Photos grid: that screen asks for kind='photo', so a data sheet does
-- not turn up in the day's site photos.

alter table site_files add column if not exists selection_id uuid references selections(id) on delete cascade;

comment on column site_files.selection_id is
  'The scope line this file evidences (selections.id). Null for ordinary site photos and documents.';

create index if not exists site_files_selection_idx on site_files (selection_id) where selection_id is not null;

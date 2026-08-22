-- Crewline schema v35 — a SWMS is a table, not a page of prose.
--
-- safety_documents.body has carried the SWMS template since v31: text, with
-- "## " lines for headings, rendered as paragraphs and bullets. That was built
-- against a placeholder I wrote. The client's actual statement arrived and it
-- is a different kind of document.
--
-- Its substance is a five-column register — task, hazards, risk rating BEFORE
-- controls, the controls, rating AFTER, who is responsible — repeated across
-- seven task groups. The ratings are the point: "3H before, 1L after" is the
-- argument that the controls work, and it is what an inspector reads. Flatten
-- that into prose and you have thrown away the document while keeping the
-- words.
--
-- So the template gains structure. `body` stays exactly as it is, for a
-- statement somebody types by hand and for every document already stored;
-- `content` is the structured form, and a row that has it renders from it.
--
-- jsonb rather than a wall of new tables and columns: a SWMS's shape is the
-- client's, not ours. Theirs has PPE icons and hazardous-substance notes and a
-- likelihood-by-consequence matrix; the next trade's will have something else.
-- Modelling that in DDL would mean a migration every time somebody's safety
-- consultant revises a layout.

alter table safety_documents add column if not exists content jsonb;

comment on column safety_documents.content is
  'Structured SWMS: task rows with hazards, controls and before/after risk ratings, plus PPE, substance notes, legislation and the sign-on register. Null means render from body.';

-- Only a template carries structure — an issued copy is a PDF plus the three
-- job facts stamped on it, and its content is whatever the template held when
-- it was issued. This is not enforced as a constraint because an issued row
-- legitimately copies content forward as its own record of what was issued.
create index if not exists safety_documents_content_idx
  on safety_documents ((content is not null)) where is_template;

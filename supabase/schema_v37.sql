-- Crewline schema v37 — unsigned_safety_docs() stops gating on what a worker
-- was never shown, or never needed to sign.
--
-- unsigned_safety_docs() (schema_v10) returned every row in safety_documents
-- for the worker's company and site that had no live signature — with no
-- filter on kind and none on is_template. Two things fell out of that:
--
--   the template   is_template rows (the company-level SWMS master) were
--                  counted as "not signed" even though nothing is ever issued
--                  against a template itself — only the copies issued from it
--                  are. A company with a template and zero issued SWMS could
--                  never clear its own gate.
--   the policy     kind='policy' documents were counted too, although the
--                  Safety tab and this screen both treat policies as company
--                  reading, not a per-shift sign-on — and the worker-facing
--                  screen (SafetyScreen.tsx) explicitly filters kind='policy'
--                  out of the list it renders, so a policy counted here had
--                  no row on screen a worker could tap to clear it. The gate
--                  could say "2 documents are not signed" while showing one
--                  tappable row, permanently.
--
-- Only real, per-job signable documents — an issued SWMS or an
-- induction/toolbox talk — should ever appear on the sign-on gate.
create or replace function unsigned_safety_docs(p_worker uuid, p_site uuid)
returns setof safety_documents
language sql stable security definer set search_path = public as $$
  select d.*
    from safety_documents d
   where d.active
     and d.company_id = (select company_id from workers where id = p_worker)
     and (d.site_id is null or d.site_id = p_site)
     and d.kind in ('swms', 'induction')
     and not d.is_template
     and not exists (
       select 1 from safety_signatures s
        where s.document_id = d.id
          and s.worker_id = p_worker
          and (
            d.resign_after_hours is null
            or s.signed_at > now() - make_interval(hours => d.resign_after_hours)
          )
     );
$$;

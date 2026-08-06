-- Storage buckets for site photos/plans and expense receipts.
-- Objects are keyed <company_id>/<site_id>/<file>, and every policy checks the
-- leading folder against the caller's company — so one company can never read
-- another's site photos even with a valid session.

insert into storage.buckets (id, name, public, file_size_limit)
values ('site-files', 'site-files', false, 26214400),
       ('receipts',   'receipts',   false, 26214400)
on conflict (id) do nothing;

drop policy if exists crewline_read on storage.objects;
create policy crewline_read on storage.objects
  for select using (
    bucket_id in ('site-files','receipts')
    and (storage.foldername(name))[1] = current_company_id()::text
  );

drop policy if exists crewline_insert on storage.objects;
create policy crewline_insert on storage.objects
  for insert with check (
    bucket_id in ('site-files','receipts')
    and (storage.foldername(name))[1] = current_company_id()::text
  );

drop policy if exists crewline_update on storage.objects;
create policy crewline_update on storage.objects
  for update using (
    bucket_id in ('site-files','receipts')
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_is_office()
  );

drop policy if exists crewline_delete on storage.objects;
create policy crewline_delete on storage.objects
  for delete using (
    bucket_id in ('site-files','receipts')
    and (storage.foldername(name))[1] = current_company_id()::text
    and current_is_office()
  );

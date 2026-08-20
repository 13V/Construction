-- Crewline schema v34 — a crew member can see who else is on their own site.
--
-- The Crew tab shows who is on this job and whether they are actually here.
-- For everyone except the office it was quietly wrong: shifts_read granted a
-- worker their OWN shift row and nothing else, so a tiler opening the Crew tab
-- saw colleagues standing ten metres away reported as merely "booked" — the
-- roster fell back to what `assignments` said, because the shift that proves
-- they clocked on was invisible.
--
-- That is worse than a missing feature. A screen that answers "who is here"
-- with a confident wrong answer, in an app whose whole premise is the geofence
-- knowing, is a screen nobody should trust again.
--
-- The fix is scoped, not a widening. Three grants beyond your own row:
--
--   the office             already had it
--   a site's captain       running the job is exactly the person who needs its
--                          roster, and captains_site() already means this
--   somebody rostered      if you are booked on that site that day, you see
--   there, that day        who else is — that site, that day
--
-- The last one is the point. It does not open shifts company-wide: a worker on
-- Glenelg learns nothing about Northgate and nothing about any other day. What
-- they learn is who is standing next to them.

-- Named for its version, like the check constraint in v32 and for the same
-- reason: the migrator proves a migration ran by looking for something that
-- did not exist before, and a policy that keeps its old name is invisible to
-- that test — it would re-run this file forever.
drop policy if exists shifts_read on shifts;
drop policy if exists shifts_read_v34 on shifts;
create policy shifts_read_v34 on shifts
  for select using (
    worker_id = current_worker_id()
    or (company_id = current_company_id() and current_is_office())
    or (company_id = current_company_id() and captains_site(site_id))
    or (
      company_id = current_company_id()
      and exists (
        select 1
          from assignments a
         where a.site_id = shifts.site_id
           and a.worker_id = current_worker_id()
           and a.starts_at::date = shifts.started_at::date
      )
    )
  );

comment on policy shifts_read_v34 on shifts is
  'Your own shifts; the office sees all; a captain sees their site; anyone rostered on a site that day sees that day''s shifts for that site.';

-- ------------------------------------------------- a tiler can start a chat

-- The Chat screen grew a compose button that opens a direct message with
-- anyone on the crew. It worked for exactly one person: the office.
--
-- channels and channel_members were both office-write-only, which was right
-- when a channel meant a job channel — those are created with the job, by the
-- office, and a worker adding themselves to one would be helping themselves to
-- a job's history. A direct message is not that. It is two people, one of whom
-- is starting it, and there is nobody else to ask.
--
-- So the grant is written as narrowly as the thing it allows:
--
--   * a worker may create a channel only where kind = 'dm', and only in their
--     own company. Job channels stay office-only, so the unique index on
--     channels_one_per_site is never something a worker can race.
--   * a worker may add members only to a dm channel, and only two kinds of
--     row: themselves, or somebody in their own company being brought into a
--     dm. Neither of those exposes a job channel.
--
-- Nothing here loosens `messages`: messages_field_insert already decides who
-- may speak in a channel, and it is unchanged.

drop policy if exists channels_dm_create on channels;
create policy channels_dm_create on channels
  for insert
  with check (
    company_id = current_company_id()
    and kind = 'dm'
    and site_id is null
  );

drop policy if exists channel_members_dm_join on channel_members;
create policy channel_members_dm_join on channel_members
  for insert
  with check (
    exists (
      select 1 from channels c
       where c.id = channel_members.channel_id
         and c.kind = 'dm'
         and c.company_id = current_company_id()
    )
    and exists (
      select 1 from workers w
       where w.id = channel_members.worker_id
         and w.company_id = current_company_id()
    )
  );

comment on policy channels_dm_create on channels is
  'A worker may start a direct message. Job channels stay office-only.';
comment on policy channel_members_dm_join on channel_members is
  'A worker may put two people from their own company into a direct message. Job channels stay office-only.';

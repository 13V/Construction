-- Crewline schema v21 — the builder's programme.
--
-- Run after schema_v20.sql. Safe to re-run.
--
-- The client listed "Program" among the things the owner needs on a job. What
-- arrives is a builder's construction programme — a Gantt chart, emailed as a
-- PDF or an Excel export, revised every few weeks — and the only line on it
-- that matters to a tiling subcontractor is theirs, plus the two trades either
-- side of it: the waterproofer before, the plumber and the shower screens after.
--
-- The value is not in redrawing the Gantt. It is in three questions:
--
--   * When are we on this job, and has that moved since the last revision?
--   * Is the job actually ready for us, or are we about to send a crew to a
--     slab that has not been screeded? (Turning up to a job that is not ready
--     is a day's wages for nothing, and it is the single most common way a
--     subcontractor loses money that no invoice ever shows.)
--   * Which of our jobs collide next week?
--
-- So the programme is stored as dated tasks, revisions are kept rather than
-- overwritten, and the previous revision's dates are carried on the row — a
-- date that moved by nine days is the thing to notice, and it is invisible if
-- the import overwrites in place.

-- ---------------------------------------------------------- the document

create table if not exists programmes (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid not null references job_sites(id) on delete cascade,
  name         text not null default 'Construction programme',
  /** The builder's own revision marker, off the drawing: "Rev C", "P4". */
  revision     text,
  issued_on    date,
  received_on  date not null default current_date,
  source       text not null default 'manual'
                 check (source in ('pdf','excel','csv','manual')),
  /** The file it came from, so the original is always one click away. */
  file_id      uuid references site_files(id) on delete set null,
  storage_path text,
  /**
   * current | superseded. Exactly one current programme per job — enforced by
   * trigger below, because "which revision are we working to" cannot be a
   * question anybody has to think about.
   */
  status       text not null default 'current'
                 check (status in ('draft','current','superseded')),
  /** What the extractor thought it was doing, kept verbatim for the human. */
  import_note  text,
  imported_by  uuid references workers(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists programmes_site_idx on programmes (site_id, status, received_on desc);

create table if not exists programme_tasks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  programme_id  uuid not null references programmes(id) on delete cascade,
  site_id       uuid not null references job_sites(id) on delete cascade,
  /** The builder's line number or WBS code, so a revision can be matched to it. */
  ref           text,
  name          text not null,
  trade         text,
  starts_on     date,
  ends_on       date,
  duration_days integer,
  /**
   * Ours. Set by the importer when the line is tiling or waterproofing, and
   * correctable by hand — everything that keys off "when are we on" reads this,
   * so a wrong guess has to be fixable in one click.
   */
  is_ours       boolean not null default false,
  /**
   * A line we depend on being finished before we can start: screed, membrane
   * cure, the plumber's rough-in. This is what makes readiness answerable.
   */
  is_predecessor boolean not null default false,
  pct_complete  numeric(5,2) not null default 0
                  check (pct_complete >= 0 and pct_complete <= 100),
  status        text not null default 'planned'
                  check (status in ('planned','in_progress','done','not_started','slipped')),
  /** Where this line sat on the PREVIOUS revision. Null on a first import. */
  prev_starts_on date,
  prev_ends_on   date,
  sort          integer not null default 0,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists programme_tasks_prog_idx on programme_tasks (programme_id, sort);
create index if not exists programme_tasks_site_idx on programme_tasks (site_id, starts_on);

-- One current programme per job. Importing a new revision supersedes the old
-- one automatically rather than relying on whoever did the import to remember.
create or replace function programmes_one_current() returns trigger
language plpgsql as $$
begin
  if new.status = 'current' then
    update programmes
       set status = 'superseded'
     where site_id = new.site_id
       and id <> new.id
       and status = 'current';
  end if;
  return new;
end $$;

drop trigger if exists programmes_one_current_t on programmes;
create trigger programmes_one_current_t
  after insert or update of status on programmes
  for each row execute function programmes_one_current();

-- Carry the previous revision's dates onto the new one, matched on the
-- builder's own line ref. Called by the import once its tasks are inserted;
-- doing it in SQL means the comparison is against what is actually stored
-- rather than against whatever the browser happened to be holding.
create or replace function programme_carry_previous(p_programme uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_site uuid;
  v_company uuid;
  v_prev uuid;
  v_moved integer;
begin
  -- SECURITY DEFINER means this runs as the owner and RLS does not apply, so
  -- the tenant check has to be made here explicitly. Without it, any signed-in
  -- user could pass another company's programme id and rewrite its dates —
  -- reading nothing back, but corrupting a job they have no business touching.
  select site_id, company_id into v_site, v_company from programmes where id = p_programme;
  if v_site is null then return 0; end if;
  if v_company is distinct from current_company_id() then
    raise exception 'That programme belongs to another company';
  end if;

  select id into v_prev
    from programmes
   where site_id = v_site and id <> p_programme
   order by received_on desc, created_at desc
   limit 1;
  if v_prev is null then return 0; end if;

  update programme_tasks t
     set prev_starts_on = o.starts_on,
         prev_ends_on   = o.ends_on
    from programme_tasks o
   where t.programme_id = p_programme
     and o.programme_id = v_prev
     and t.ref is not null
     and o.ref is not null
     and lower(trim(t.ref)) = lower(trim(o.ref));

  get diagnostics v_moved = row_count;
  return v_moved;
end $$;

-- ------------------------------------------------- when are we on, and is it ready

-- One row per job: our next window on the programme, and whether the lines we
-- depend on are actually finished. `blocked_by` names them, because "not ready"
-- without saying what is not ready is not information anybody can act on.
drop view if exists site_programme_v cascade;
create view site_programme_v with (security_invoker = on) as
with current_prog as (
  select id, site_id, revision, received_on
    from programmes
   where status = 'current'
),
ours as (
  select distinct on (t.site_id)
         t.site_id, t.programme_id, t.name, t.starts_on, t.ends_on,
         t.prev_starts_on, t.prev_ends_on, t.status, t.pct_complete
    from programme_tasks t
    join current_prog p on p.id = t.programme_id
   where t.is_ours
     and t.ends_on >= current_date
   order by t.site_id, t.starts_on nulls last
),
blockers as (
  select t.site_id,
         count(*) filter (where t.status <> 'done')                       as open_count,
         string_agg(t.name, ', ' order by t.ends_on)
           filter (where t.status <> 'done')                              as blocked_by
    from programme_tasks t
    join current_prog p on p.id = t.programme_id
   where t.is_predecessor
   group by t.site_id
)
select p.site_id,
       p.id                                   as programme_id,
       p.revision,
       p.received_on,
       o.name                                 as our_task,
       o.starts_on                            as our_start,
       o.ends_on                              as our_end,
       o.prev_starts_on,
       o.status                               as our_status,
       o.pct_complete                         as our_pct,
       -- How far the start has moved since the last revision. Positive is later.
       case when o.starts_on is not null and o.prev_starts_on is not null
            then o.starts_on - o.prev_starts_on end   as start_moved_days,
       case when o.starts_on is not null
            then o.starts_on - current_date end       as days_until_start,
       coalesce(b.open_count, 0)              as blockers_open,
       b.blocked_by,
       -- Ready when nothing we depend on is still open. Null when the programme
       -- names no predecessors at all, which is honestly "we don't know" rather
       -- than a green light.
       case when b.site_id is null then null
            else coalesce(b.open_count, 0) = 0 end     as ready
  from current_prog p
  left join ours o     on o.site_id = p.site_id
  left join blockers b on b.site_id = p.site_id;

comment on view site_programme_v is
  'Our next window on the builder''s current programme, how far it has moved since the last revision, and whether the trades we follow have actually finished. ready is null when the programme names no predecessors — that is "unknown", not "go".';

-- ------------------------------------------------------------------- RLS

alter table programmes      enable row level security;
alter table programme_tasks enable row level security;

-- The programme is not commercial and the crew needs it more than the office
-- does: "are we on next Tuesday" is a question asked from a ute, not a desk.
do $$
declare t text;
begin
  foreach t in array array['programmes','programme_tasks']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (company_id = current_company_id())', t, t);
    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format('create policy %I_office_write on %I for all
      using (company_id = current_company_id() and (current_is_office() or captains_site(site_id)))
      with check (company_id = current_company_id() and (current_is_office() or captains_site(site_id)))', t, t);
  end loop;
end $$;

-- --------------------------------------------------------------- realtime

do $$
declare t text;
begin
  foreach t in array array['programmes','programme_tasks']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

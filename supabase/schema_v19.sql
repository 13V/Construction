-- Crewline schema v19 — defects, instructions, progress, and waterproofing.
--
-- Run after schema_v18.sql. Safe to re-run.
--
-- The four things the client listed that a tiling subcontractor actually gets
-- held to, none of which the app could record:
--
--   Site instructions   A builder's supervisor tells you to do something. If it
--                       is not written down, it is a variation you did for free.
--   Defects             The list that stands between practical completion and
--                       the retention being released.
--   Progress            "How far through is Lot 42" answered by something other
--                       than a guess.
--   Waterproofing       AS 3740. Under the SA Building Code a waterproofing
--                       membrane is a critical stage: it is covered by screed
--                       and tiles within a day, and after that the only evidence
--                       it was ever done properly is what was recorded before
--                       the tiler covered it up. This is the single highest
--                       liability item on a tiler's work and the app had no
--                       record of it at all.
--
-- All four are per-job, all four are read by the crew and written by the crew,
-- and none of them is money — so they follow the schema_v18 line: the office
-- writes everything, a captain writes on their own jobs, and a worker on site
-- can raise what they can see.

-- ------------------------------------------------------- site instructions

-- A direction from the builder. The whole value is in it being dated, attributed
-- and unedited afterwards, because six weeks later the argument is whether it
-- was ever given.
create table if not exists site_instructions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid not null references job_sites(id) on delete cascade,
  /** Sequential per company, like a variation number. Their reference, if they gave one. */
  ref          text,
  builder_ref  text,
  received_on  date not null default current_date,
  /** Who gave it. Free text on purpose: it is often a name and a phone call. */
  from_name    text,
  from_contact_id uuid references builder_contacts(id) on delete set null,
  how          text not null default 'verbal'
                 check (how in ('verbal','email','site_meeting','written','drawing')),
  instruction  text not null,
  /**
   * The point of the record. An instruction that changes scope is a variation
   * waiting to be raised, and the link is what stops it being forgotten.
   */
  is_variation boolean not null default false,
  change_order_id uuid references change_orders(id) on delete set null,
  status       text not null default 'open'
                 check (status in ('open','actioned','disputed','closed')),
  photo_path   text,
  note         text,
  raised_by    uuid references workers(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists site_instructions_site_idx on site_instructions (site_id, received_on desc);

-- --------------------------------------------------------------- defects

create table if not exists defects (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid not null references job_sites(id) on delete cascade,
  ref          text,
  /** Where in the building. "Ensuite, Lot 42" — a QS list is organised by room. */
  location     text,
  description  text not null,
  /**
   * Whose it is. A tiler's defect list is half other trades' damage, and the
   * distinction decides who pays to fix it.
   */
  raised_by_party text not null default 'builder'
                 check (raised_by_party in ('builder','client','us','certifier','other')),
  responsible  text not null default 'us'
                 check (responsible in ('us','builder','other_trade','client','unknown')),
  severity     text not null default 'minor'
                 check (severity in ('minor','major','critical')),
  status       text not null default 'open'
                 check (status in ('open','in_progress','fixed','rejected','verified')),
  raised_on    date not null default current_date,
  due_on       date,
  fixed_on     date,
  verified_on  date,
  verified_by  uuid references workers(id) on delete set null,
  /** The before and after. A defect closed without a photo is a defect reopened. */
  photo_path   text,
  fixed_photo_path text,
  /** Links to the plan mark-up, so "which shower" is never ambiguous. */
  plan_pin_id  uuid references plan_pins(id) on delete set null,
  cost_estimate numeric(12,2),
  note         text,
  created_by   uuid references workers(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists defects_site_idx on defects (site_id, status, raised_on desc);

-- ---------------------------------------------------------------- progress

-- Progress claimed against measured work rather than a feeling. One row per
-- area per assessment, so a claim can be justified line by line if a QS asks.
create table if not exists progress_entries (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid not null references job_sites(id) on delete cascade,
  /** "Ensuite floor", "Level 2 balconies". Matches how the job was priced. */
  area         text not null,
  cost_code    text,
  /** What the whole area is, and how much of it is done. Metric, always. */
  unit         text not null default 'm2' check (unit in ('m2','lm','item','room','%')),
  quantity     numeric(12,2),
  done_quantity numeric(12,2) not null default 0,
  pct_complete numeric(5,2) not null default 0
                 check (pct_complete >= 0 and pct_complete <= 100),
  assessed_on  date not null default current_date,
  assessed_by  uuid references workers(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists progress_site_idx on progress_entries (site_id, assessed_on desc);

-- The current picture: the latest assessment per area, and the job's overall
-- percentage weighted by quantity where there is one. Weighted, because a job
-- that is 100% through a 2 m² powder room and 10% through 300 m² of balconies
-- is not 55% done, and a flat average is exactly how a subcontractor over-claims
-- without meaning to.
-- `cascade`, on every view drop in this repo. A later migration builds views on
-- top of this one (job_profit_v and company_overview_v read job_value_v and
-- invoice_status_v), and Postgres refuses to drop a view something depends on.
-- Without cascade, re-running this file on an up-to-date database aborts — and
-- DEPLOY.md's instruction is to run the whole list in order, so an abort here
-- means every migration after it silently never runs. That exact failure has
-- now happened twice. The dependants are recreated by the later file, which
-- always runs after this one; the run is only ever safe as a complete run,
-- which is what the runbook has said all along.
drop view if exists site_progress_v cascade;
create view site_progress_v with (security_invoker = on) as
with latest as (
  select distinct on (site_id, area)
         site_id, area, cost_code, unit, quantity, done_quantity, pct_complete, assessed_on
    from progress_entries
   order by site_id, area, assessed_on desc, created_at desc
)
select site_id,
       count(*)                                        as area_count,
       max(assessed_on)                                as last_assessed_on,
       round(
         case when sum(coalesce(quantity, 0)) > 0
              then sum(pct_complete * coalesce(quantity, 0)) / sum(coalesce(quantity, 0))
              else avg(pct_complete) end, 1)           as pct_complete,
       sum(coalesce(quantity, 0))                      as total_quantity,
       sum(coalesce(done_quantity, 0))                 as done_quantity
  from latest
 group by site_id;

comment on view site_progress_v is
  'Latest assessment per area, rolled up weighted by quantity. A flat average over areas of wildly different size is how a subcontractor over-claims by accident.';

-- --------------------------------------------------------- waterproofing

-- AS 3740 wet area waterproofing. The membrane goes in, it is inspected, and
-- then it is covered by screed and tiles the same week — after which nothing can
-- be checked without demolition. If a shower leaks in two years, this record is
-- the whole defence, so it is built to be evidence: the batch, the coats, the
-- date, the photos, and a signature that cannot be back-dated silently.
create table if not exists waterproofing (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  site_id       uuid not null references job_sites(id) on delete cascade,
  /** "Ensuite", "Main bath", "Laundry" — one record per wet area, always. */
  area          text not null,
  /** The membrane actually used, and its batch, straight off the drum. */
  product_id    uuid references products(id) on delete set null,
  product_name  text,
  batch_no      text,
  /** AS 3740 wants the substrate recorded: it changes the primer and the falls. */
  substrate     text,
  primer        text,
  coats         integer not null default 2 check (coats between 1 and 5),
  /** Bond breakers and angle fillet — the two things a leak inquiry asks about first. */
  bond_breaker  boolean not null default false,
  angle_fillet  boolean not null default false,
  /** Millimetres up the wall. 150 minimum outside a shower, 1800 inside one. */
  wall_height_mm integer,
  started_on    date,
  completed_on  date,
  /** Water test held for 24 hours, per AS 3740 clause 3.7. */
  flood_tested  boolean not null default false,
  flood_test_on date,
  flood_test_hours integer,
  installer_id  uuid references workers(id) on delete set null,
  installer_licence text,
  status        text not null default 'planned'
                 check (status in ('planned','in_progress','complete','signed_off','failed')),
  /** Signed off by whoever is accountable. Stamped, not typed — see the trigger. */
  signed_off_by uuid references workers(id) on delete set null,
  signed_off_at timestamptz,
  signed_off_name text,
  /** The certificate handed to the builder, once it has been generated. */
  certificate_path text,
  certificate_no text,
  note          text,
  created_by    uuid references workers(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (site_id, area)
);
create index if not exists waterproofing_site_idx on waterproofing (site_id, status);

-- Photos of a membrane are the evidence, and there are always several: the
-- fillet, each coat, the flood test standing. They hang off site_files so they
-- land in the same bucket, with the same policies, as every other site photo.
create table if not exists waterproofing_photos (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  waterproofing_id uuid not null references waterproofing(id) on delete cascade,
  file_id       uuid references site_files(id) on delete set null,
  storage_path  text not null,
  stage         text not null default 'membrane'
                 check (stage in ('substrate','primer','fillet','membrane','second_coat','flood_test','other')),
  caption       text,
  taken_at      timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists wp_photos_idx on waterproofing_photos (waterproofing_id, stage);

-- The sign-off is stamped by the database from the caller's identity, never
-- accepted from the client. A waterproofing certificate is a document someone
-- can be prosecuted over; "who signed it and when" is not a form field.
create or replace function waterproofing_stamp_signoff() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'signed_off' and (old is null or old.status <> 'signed_off') then
    new.signed_off_at := now();
    new.signed_off_by := coalesce(current_worker_id(), new.signed_off_by);
    new.signed_off_name := coalesce(
      (select name from workers where id = new.signed_off_by), new.signed_off_name);
    -- A membrane cannot be signed off before it is finished, and this is the
    -- one place that can be enforced for every screen at once.
    if new.completed_on is null then
      new.completed_on := current_date;
    end if;
  elsif new.status <> 'signed_off' then
    new.signed_off_at := null;
    new.signed_off_by := null;
    new.signed_off_name := null;
    new.certificate_path := null;
    new.certificate_no := null;
  end if;
  return new;
end $$;

drop trigger if exists waterproofing_stamp_signoff_t on waterproofing;
create trigger waterproofing_stamp_signoff_t
  before insert or update on waterproofing
  for each row execute function waterproofing_stamp_signoff();

-- What is left before this job's wet areas are defensible. Reads as one row per
-- site so a job list can show it without a subquery per row.
drop view if exists site_waterproofing_v cascade;
create view site_waterproofing_v with (security_invoker = on) as
  select w.site_id,
         count(*)                                                as area_count,
         count(*) filter (where w.status = 'signed_off')         as signed_off_count,
         count(*) filter (where w.status = 'failed')             as failed_count,
         count(*) filter (where w.status <> 'signed_off')        as outstanding_count,
         -- Signed off with no flood test, or no photo. Both are certificates
         -- that will not hold up, and both are silent until someone looks.
         count(*) filter (where w.status = 'signed_off' and not w.flood_tested) as unflooded_count,
         count(*) filter (
           where w.status = 'signed_off'
             and not exists (select 1 from waterproofing_photos p where p.waterproofing_id = w.id)
         )                                                       as unphotographed_count,
         min(w.completed_on)                                     as first_completed_on,
         max(w.completed_on)                                     as last_completed_on
    from waterproofing w
   group by w.site_id;

-- ------------------------------------------------------------------- RLS

alter table site_instructions    enable row level security;
alter table defects              enable row level security;
alter table progress_entries     enable row level security;
alter table waterproofing        enable row level security;
alter table waterproofing_photos enable row level security;

-- None of this is money, and all of it is the work. The whole company reads it:
-- a tiler needs to know what the defect list says about the shower they are
-- standing in, and a chippie needs to know the membrane is not signed off before
-- they screed over it.
do $$
declare t text;
begin
  foreach t in array array['site_instructions','defects','progress_entries','waterproofing']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (company_id = current_company_id())', t, t);

    -- The office anywhere, a captain on their own jobs.
    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format('create policy %I_office_write on %I for all
      using (company_id = current_company_id() and (current_is_office() or captains_site(site_id)))
      with check (company_id = current_company_id() and (current_is_office() or captains_site(site_id)))', t, t);

    -- And anyone in the company can RAISE one. A defect noticed by the labourer
    -- who is standing in front of it is worth more than the same defect noticed
    -- by the office three weeks later, and requiring a role to report a problem
    -- is how problems stop being reported. Editing still needs office or captain.
    --
    -- progress_entries is excluded on purpose: a progress percentage is what a
    -- claim is justified with, so letting anyone type one in makes over-claiming
    -- an accident rather than a decision.
    execute format('drop policy if exists %I_field_insert on %I', t, t);
    if t <> 'progress_entries' then
      execute format('create policy %I_field_insert on %I for insert
        with check (company_id = current_company_id())', t, t);
    end if;
  end loop;
end $$;

-- Photos follow their waterproofing record.
drop policy if exists waterproofing_photos_read on waterproofing_photos;
create policy waterproofing_photos_read on waterproofing_photos
  for select using (company_id = current_company_id());

drop policy if exists waterproofing_photos_write on waterproofing_photos;
create policy waterproofing_photos_write on waterproofing_photos
  for all
  using (
    company_id = current_company_id()
    and exists (select 1 from waterproofing w
                 where w.id = waterproofing_photos.waterproofing_id
                   and (current_is_office() or captains_site(w.site_id)))
  )
  with check (
    company_id = current_company_id()
    and exists (select 1 from waterproofing w
                 where w.id = waterproofing_photos.waterproofing_id
                   and (current_is_office() or captains_site(w.site_id)))
  );

-- A worker photographing the membrane they just laid is the entire point.
drop policy if exists waterproofing_photos_field_insert on waterproofing_photos;
create policy waterproofing_photos_field_insert on waterproofing_photos
  for insert with check (company_id = current_company_id());

-- Portal: the builder's own supervisor should be able to see the defect list on
-- their job. NOT `cost_estimate` — that is what it will cost US to fix, and
-- handing the other side of a dispute your own repair costing is indefensible.
--
-- So there is deliberately NO portal policy on `defects`. A security_invoker
-- view cannot hide a column from someone who can read the table, because they
-- can simply read the table instead; the only thing that drops a column is a
-- view the reader cannot go around. This one is security DEFINER, which means
-- its WHERE clause is the entire gate and has to be right:
-- current_portal_site() returns the one site that portal login is attached to,
-- and null for everyone else, so a staff member selecting this view gets
-- nothing and reads the table as usual.
drop view if exists portal_defects_v cascade;
create view portal_defects_v with (security_invoker = off) as
  select id, site_id, ref, location, description, raised_by_party, responsible,
         severity, status, raised_on, due_on, fixed_on, verified_on, photo_path, fixed_photo_path
    from defects
   where site_id = current_portal_site();

comment on view portal_defects_v is
  'The defect list as the builder may see it. SECURITY DEFINER: the where clause is the only thing standing between a portal login and every defect in the company. cost_estimate is dropped on purpose.';

drop policy if exists waterproofing_portal_read on waterproofing;
create policy waterproofing_portal_read on waterproofing
  for select using (site_id = current_portal_site());

-- --------------------------------------------------------------- realtime

do $$
declare t text;
begin
  foreach t in array array['site_instructions','defects','progress_entries',
                           'waterproofing','waterproofing_photos']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

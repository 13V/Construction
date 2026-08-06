-- Crewline schema v2 — scheduling, files, expenses, daily logs, chat,
-- equipment and safety. Run after schema.sql. Safe to re-run.
--
-- Same posture as v1: every table is company-scoped under RLS, office users
-- manage, field users see their own work and their sites.

-- ------------------------------------------------------------- scheduling

create table if not exists assignments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  worker_id   uuid not null references workers(id) on delete cascade,
  site_id     uuid not null references job_sites(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  note        text,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists assignments_company_start_idx on assignments (company_id, starts_at);
create index if not exists assignments_worker_start_idx on assignments (worker_id, starts_at);

-- ------------------------------------------------------- photos and plans

create table if not exists site_files (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  site_id      uuid not null references job_sites(id) on delete cascade,
  uploaded_by  uuid references workers(id) on delete set null,
  kind         text not null check (kind in ('photo','document')),
  -- Path inside the `site-files` storage bucket.
  storage_path text not null,
  name         text not null,
  mime         text,
  size_bytes   bigint,
  -- photos: progress | issue | before | after | inspection
  -- documents: plan | permit | drawing | change_order | survey | other
  category     text,
  caption      text,
  -- Where the photo was taken, when the phone reported it.
  lat          double precision,
  lng          double precision,
  taken_at     timestamptz,
  version      text,
  supersedes   uuid references site_files(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists site_files_site_idx on site_files (site_id, created_at desc);

-- ---------------------------------------------------------------- expenses

create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  site_id       uuid references job_sites(id) on delete set null,
  submitted_by  uuid references workers(id) on delete set null,
  vendor        text not null default '',
  spent_on      date not null default current_date,
  amount        numeric(12,2) not null default 0,
  tax           numeric(12,2) not null default 0,
  category      text,
  cost_code     text,
  receipt_path  text,
  status        text not null default 'needs_review'
                  check (status in ('needs_review','confirmed','flagged')),
  -- What the extraction concluded, shown verbatim to the owner so a wrong
  -- reading is obvious rather than buried.
  ai_note       text,
  ai_confidence real,
  line_items    jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists expenses_company_date_idx on expenses (company_id, spent_on desc);
create index if not exists expenses_site_idx on expenses (site_id);

-- -------------------------------------------------------------- daily logs

create table if not exists daily_logs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  site_id        uuid not null references job_sites(id) on delete cascade,
  log_date       date not null default current_date,
  status         text not null default 'draft' check (status in ('draft','confirmed')),
  weather        text,
  work_completed text,
  materials      text,
  equipment_note text,
  issues         text,
  extra_notes    text,
  -- Snapshot of hours/crew at generation time so the log stays true even if
  -- a timesheet is edited later.
  crew_summary   jsonb not null default '[]'::jsonb,
  generated_at   timestamptz,
  confirmed_by   uuid references workers(id) on delete set null,
  confirmed_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (site_id, log_date)
);
create index if not exists daily_logs_company_date_idx on daily_logs (company_id, log_date desc);

-- -------------------------------------------------------------------- chat

create table if not exists channels (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid references job_sites(id) on delete cascade,
  kind        text not null default 'site' check (kind in ('site','dm')),
  name        text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists channels_one_per_site
  on channels (site_id) where kind = 'site';

create table if not exists channel_members (
  channel_id uuid not null references channels(id) on delete cascade,
  worker_id  uuid not null references workers(id) on delete cascade,
  primary key (channel_id, worker_id)
);

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  channel_id      uuid not null references channels(id) on delete cascade,
  -- Null author means a system message: a clock-in, an expense, a log.
  author_id       uuid references workers(id) on delete set null,
  kind            text not null default 'user' check (kind in ('user','system')),
  body            text not null default '',
  attachment_path text,
  created_at      timestamptz not null default now()
);
create index if not exists messages_channel_created_idx on messages (channel_id, created_at desc);

-- --------------------------------------------------------------- equipment

create table if not exists equipment (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  code         text not null,
  name         text not null,
  type         text,
  site_id      uuid references job_sites(id) on delete set null,
  operator_id  uuid references workers(id) on delete set null,
  status       text not null default 'idle'
                 check (status in ('in_use','idle','maintenance')),
  hours_total  numeric(10,1) not null default 0,
  last_used_at timestamptz,
  service_due  date,
  notes        text,
  created_at   timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists equipment_company_idx on equipment (company_id);

-- ------------------------------------------------------------------ safety

create table if not exists safety_records (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  site_id     uuid references job_sites(id) on delete set null,
  worker_id   uuid references workers(id) on delete set null,
  kind        text not null check (kind in ('jha','incident','toolbox','hazard')),
  title       text not null,
  body        text,
  severity    text check (severity in ('low','medium','high')),
  occurred_at timestamptz not null default now(),
  photo_path  text,
  -- [{worker_id, name, signed_at}]
  signatures  jsonb not null default '[]'::jsonb,
  status      text not null default 'open' check (status in ('open','closed')),
  created_at  timestamptz not null default now()
);
create index if not exists safety_company_idx on safety_records (company_id, occurred_at desc);

-- ----------------------------------------------------------- worker certs

create table if not exists certifications (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  worker_id  uuid not null references workers(id) on delete cascade,
  name       text not null,
  expires_on date,
  created_at timestamptz not null default now()
);
create index if not exists certifications_worker_idx on certifications (worker_id);

-- --------------------------------------------------------------------- RLS

alter table assignments     enable row level security;
alter table site_files      enable row level security;
alter table expenses        enable row level security;
alter table daily_logs      enable row level security;
alter table channels        enable row level security;
alter table channel_members enable row level security;
alter table messages        enable row level security;
alter table equipment       enable row level security;
alter table safety_records  enable row level security;
alter table certifications  enable row level security;

-- Everyone in the company reads; office writes. Field staff additionally get
-- to create the things they produce in the field.
do $$
declare t text;
begin
  foreach t in array array['assignments','site_files','expenses','daily_logs',
                           'channels','messages','equipment','safety_records',
                           'certifications']
  loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format(
      'create policy %I_read on %I for select using (company_id = current_company_id())', t, t);

    execute format('drop policy if exists %I_office_write on %I', t, t);
    execute format(
      'create policy %I_office_write on %I for all
         using (company_id = current_company_id() and current_is_office())
         with check (company_id = current_company_id() and current_is_office())', t, t);
  end loop;
end $$;

-- Field crew create what they capture on site.
drop policy if exists site_files_field_insert on site_files;
create policy site_files_field_insert on site_files
  for insert with check (
    company_id = current_company_id() and uploaded_by = current_worker_id());

drop policy if exists expenses_field_insert on expenses;
create policy expenses_field_insert on expenses
  for insert with check (
    company_id = current_company_id() and submitted_by = current_worker_id());

drop policy if exists messages_field_insert on messages;
create policy messages_field_insert on messages
  for insert with check (
    company_id = current_company_id() and author_id = current_worker_id());

drop policy if exists safety_field_insert on safety_records;
create policy safety_field_insert on safety_records
  for insert with check (
    company_id = current_company_id() and worker_id = current_worker_id());

-- A foreman confirms the daily log for their site.
drop policy if exists daily_logs_field_update on daily_logs;
create policy daily_logs_field_update on daily_logs
  for update using (company_id = current_company_id())
  with check (company_id = current_company_id());

drop policy if exists channel_members_read on channel_members;
create policy channel_members_read on channel_members
  for select using (
    channel_id in (select id from channels where company_id = current_company_id()));

drop policy if exists channel_members_office_write on channel_members;
create policy channel_members_office_write on channel_members
  for all using (current_is_office()) with check (current_is_office());

-- ---------------------------------------------------------------- realtime

do $$
declare t text;
begin
  foreach t in array array['assignments','site_files','expenses','daily_logs',
                           'messages','equipment','safety_records']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- Every job site gets a chat channel automatically.
create or replace function create_site_channel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into channels (company_id, site_id, kind, name)
  values (new.company_id, new.id, 'site', new.name)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists job_sites_channel on job_sites;
create trigger job_sites_channel after insert on job_sites
  for each row execute function create_site_channel();

-- Backfill channels for sites that already exist.
insert into channels (company_id, site_id, kind, name)
select company_id, id, 'site', name from job_sites
where id not in (select site_id from channels where site_id is not null)
on conflict do nothing;

-- Crewline schema v30 — the waterproofing package a certificate is issued for.
--
-- The client's own Certificate of Compliance covers "waterproofing to bathroom
-- + ensuite + wc + balcony + laundry" — one document, one apartment, five wet
-- areas. The existing `waterproofing` table cannot hold it: that table is one
-- row per wet area, which is the right shape for the install register (AS 3740
-- wants the substrate, primer, coats and fillet recorded area by area) and the
-- wrong shape for the certificate. A certificate number, the date the builder
-- signed, the date it was emailed — none of those belong to a balcony.
--
-- So the package is its own row, and the two tables answer different questions:
--
--   waterproofing            what went on this wet area, and was it tested
--   waterproofing_packages   what we are certifying, and where that is up to
--
-- The package is also the six-step checklist the client drew: products,
-- install date, flood test, builder sign-off, certificates, photos. Each step
-- is a column or two here plus its evidence in site_files, so "5/6 complete"
-- is computed from the record rather than stored as a number that can drift.

create table if not exists waterproofing_packages (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  site_id       uuid not null references job_sites(id) on delete cascade,
  /** "Apt 12", "Unit 5" — the client's certificate has an Apartment No. field.
   *  Null on a house, where the project IS the unit. */
  unit          text,

  -- step 1 --------------------------------------------------------- products
  /** Two products, because the client specifies them separately and the
   *  certificate says which is which: Mapei Mapelastic AquaDefense inside,
   *  Mapelastic Smart out on the balcony. */
  product_internal text,
  product_external text,

  -- step 2 ---------------------------------------------------------- install
  installed_on  date,
  /** Who laid it. Our own trading name in almost every case, but a package
   *  can be certified over another applicator's work. */
  installed_by  text,

  -- step 3 ------------------------------------------------------- flood test
  /** Before the test this is when it is booked for; after it, when it was
   *  held. The result column is what says which. */
  flood_test_on date,
  flood_test_result text not null default 'not_completed'
                 check (flood_test_result in ('not_completed','pass','fail')),
  flood_test_hours integer,

  -- step 4 --------------------------------------------------- builder signoff
  /** Typed, not stamped — unlike our own sign-off. The builder's rep writes
   *  their name on a phone held out to them, and the acknowledgement they are
   *  giving is that they inspected before tiling. Their real signature goes on
   *  the printed certificate. */
  builder_signed_name text,
  builder_signed_at timestamptz,

  -- step 5 ------------------------------------------------------ certificate
  /** PTS-WP-YYMMDD-NNN, allocated when the certificate is first generated and
   *  never reissued: the number is what the builder files it under. */
  certificate_no text,
  certificate_generated_at timestamptz,
  certificate_path text,
  certificate_sent_at timestamptz,
  certificate_sent_to text,

  -- the certificate's own fields ------------------------------------------
  /** "waterproofing to bathroom + ensuite + wc + balcony + laundry". Filled
   *  from the job's wet areas when the package is created, then editable —
   *  the document says what was done, in the words that go on it. */
  scope_of_work text,
  /** Date of Completion on the certificate. Distinct from installed_on: the
   *  membrane goes on before the flood test passes. */
  completion_on date,
  warranty_years integer not null default 2 check (warranty_years between 1 and 10),

  note          text,
  created_by    uuid references workers(id) on delete set null,
  created_at    timestamptz not null default now(),
  /** One package per unit on a job. A house has one, with unit null — which
   *  a plain unique() would not enforce, hence the two indexes below. */
  unique (site_id, unit)
);

create index if not exists wp_packages_site_idx on waterproofing_packages (site_id);
-- unique(site_id, unit) does not constrain rows where unit is null, so the
-- one-package-per-house case needs saying separately.
create unique index if not exists wp_packages_site_nounit_idx
  on waterproofing_packages (site_id) where unit is null;

comment on table waterproofing_packages is
  'The waterproofing on one apartment or project, as one Certificate of Compliance covers it. Per-wet-area detail stays in waterproofing.';

-- ------------------------------------------------------------- the evidence

-- Every step carries uploads: product data sheets, membrane photos, the flood
-- test, the two warranty certificates. site_files already has the storage
-- path, the mime, the uploader and the RLS that keeps a company inside its own
-- folder, so this is one column and not a fifth parallel file table.
--
-- wp_step says which step an upload belongs to, so the Products row can count
-- its two data sheets without counting the twelve membrane photos.

alter table site_files add column if not exists waterproofing_package_id
  uuid references waterproofing_packages(id) on delete cascade;
alter table site_files add column if not exists wp_step text
  check (wp_step in ('products','install','flood_test','signoff','certificates'));

comment on column site_files.waterproofing_package_id is
  'The waterproofing package this file evidences. Null for ordinary site photos and documents.';
comment on column site_files.wp_step is
  'Which of the six waterproofing steps the file belongs to. Null unless waterproofing_package_id is set.';

create index if not exists site_files_wp_pkg_idx
  on site_files (waterproofing_package_id, wp_step)
  where waterproofing_package_id is not null;

-- ------------------------------------------------------------------- access

-- The field crew read the whole package and write the parts they do on site:
-- the install date, the flood test result, the photos. The builder's name on
-- the sign-off row is also theirs to enter — they are the one standing next to
-- the builder. What they cannot do is issue the certificate: the number and
-- the sent-at are office actions, and there is no way to express that as a
-- row policy, so it is enforced where it can be — see the trigger below.

alter table waterproofing_packages enable row level security;

drop policy if exists wp_packages_read on waterproofing_packages;
create policy wp_packages_read on waterproofing_packages
  for select using (company_id = current_company_id());

drop policy if exists wp_packages_insert on waterproofing_packages;
create policy wp_packages_insert on waterproofing_packages
  for insert with check (company_id = current_company_id());

drop policy if exists wp_packages_update on waterproofing_packages;
create policy wp_packages_update on waterproofing_packages
  for update using (company_id = current_company_id())
  with check (company_id = current_company_id());

drop policy if exists wp_packages_delete on waterproofing_packages;
create policy wp_packages_delete on waterproofing_packages
  for delete using (company_id = current_company_id() and current_is_office());

-- A certificate number is not a form field. Once allocated it is the builder's
-- filing reference, and a second document carrying the same number — or the
-- same document carrying a new one — is the kind of thing that gets read out
-- in a dispute. So the number is write-once, and only the office may set it.
create or replace function wp_package_guard_certificate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.certificate_no is not null and new.certificate_no is distinct from old.certificate_no then
      raise exception 'certificate_no is write-once (% already issued)', old.certificate_no;
    end if;
    if new.certificate_no is distinct from old.certificate_no
       and new.certificate_no is not null
       and not current_is_office() then
      raise exception 'only the office can issue a certificate';
    end if;
    if new.certificate_sent_at is distinct from old.certificate_sent_at
       and not current_is_office() then
      raise exception 'only the office can send a certificate';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists wp_package_guard on waterproofing_packages;
create trigger wp_package_guard before update on waterproofing_packages
  for each row execute function wp_package_guard_certificate();

-- ---------------------------------------------------------- who is certifying

-- The certificate's identity line names the legal entity AND the trading name:
--
--   ABN: 72 101 512 485 | Proven Solutions Pty. Ltd. Trading as Proven Tiling
--   Solutions | BLD 187384
--
-- companies.name is the trading name — it is what the app says everywhere and
-- what a builder calls us. The Pty Ltd behind it had nowhere to live, and on a
-- compliance certificate that somebody may have to enforce, the entity that
-- gave the warranty is not a detail to leave off.
alter table companies add column if not exists legal_name text;

comment on column companies.legal_name is
  'Registered entity, when it differs from the trading name in companies.name. Appears on the certificate identity line as "<legal_name> Trading as <name>".';

-- The name that signs. Our own sign-off is stamped from the caller's identity,
-- but a Certificate of Compliance is signed by the licensed contractor, who is
-- usually not the person tapping the button.
alter table companies add column if not exists certifier_name text;

comment on column companies.certifier_name is
  'The licensed waterproofing contractor who signs a Certificate of Compliance. Falls back to the issuing worker''s name.';

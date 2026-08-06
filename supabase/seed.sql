-- Demo data matching the front-end seed, with fixed UUIDs so it is reproducible.
-- Run after schema.sql. Safe to re-run.

insert into companies (id, name) values
  ('00000000-0000-4000-8000-000000000001', 'Whitcomb Builders')
on conflict (id) do nothing;

insert into job_sites (id, company_id, name, address, job_type, status, lat, lng, radius_m) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001',
   'Maple Ridge', '4412 Sandgate Rd, Nundah QLD', 'Custom home — framing', 'active',
   -27.4055, 153.0490, 152),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001',
   'Northgate Plaza', '1900 Toombul Rd, Northgate QLD', 'Tenant improvement', 'active',
   -27.3905, 153.0715, 122),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001',
   'Harbor View 3B', '88 Kingsford Smith Dr, Hamilton QLD', 'Condo remodel', 'active',
   -27.4390, 153.0700, 107),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001',
   'City Line Storage', '7715 Nudgee Rd, Hendra QLD', 'Slab & site work', 'starting_soon',
   -27.4180, 153.0640, 122)
on conflict (id) do nothing;

insert into workers (id, company_id, name, initials, trade, rate, is_office) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001',
   'Miguel Ortiz', 'MO', 'Foreman', 68, false),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001',
   'Danny Whitfield', 'DW', 'Framer', 54, false),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001',
   'Rosa Delgado', 'RD', 'Finish carpenter', 58, false),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001',
   'Tre Coleman', 'TC', 'Laborer', 42, false),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000001',
   'Sam Nguyen', 'SN', 'Electrician', 62, false),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000001',
   'Bobby Kaminski', 'BK', 'Equipment operator', 56, false),
  ('00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000001',
   'Alicia Moreno', 'AM', 'Drywall', 52, false)
on conflict (id) do nothing;

-- Link a signed-up user to a worker row so RLS resolves their company, e.g.:
--   update workers set auth_user_id = '<uuid from auth.users>', is_office = true
--   where id = '00000000-0000-4000-8000-000000000101';

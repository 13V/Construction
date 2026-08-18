-- Crewline schema v32 — the builder's project manager.
--
-- The client's project details screen names three people on the builder's
-- side: the project manager, the site supervisor and the contract
-- administrator. Two of those roles existed; the project manager did not, so
-- the person who actually answers a question about the programme would have
-- had to be filed as "other" and shown as nothing in particular.
--
-- The constraint is renamed as well as rewritten. A check constraint is
-- invisible to the migrator's "is it there yet" query, which looks at tables,
-- views, functions and columns — giving the new rule its own name is what lets
-- this migration prove it ran.

alter table builder_contacts drop constraint if exists builder_contacts_role_check;
alter table builder_contacts drop constraint if exists builder_contacts_role_check_v32;
alter table builder_contacts add constraint builder_contacts_role_check_v32
  check (role in ('project_manager', 'supervisor', 'contract_admin', 'accounts', 'estimator', 'other'));

comment on column builder_contacts.role is
  'project_manager | supervisor | contract_admin | accounts | estimator | other. The first three are what a job screen shows.';

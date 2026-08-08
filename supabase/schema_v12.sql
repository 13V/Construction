-- Crewline schema v12 — let the geofence engine close the shift it opened.
--
-- Run after schema_v11.sql. Safe to re-run.
--
-- schema_v6 added shifts_worker_guard so a field worker could set a cost code
-- and a break on their own open shift but not move the times, because a
-- clock-in is evidence. The guard lets office users through:
--
--     if current_is_office() then return new; end if;
--
-- current_is_office() is `coalesce((select is_office ... where auth_user_id =
-- auth.uid()), false)`. The geofence engine in api/ping.ts writes as the
-- service role, which has no auth.uid() at all, so that coalesce returns
-- FALSE and the engine fell through to the guard and was refused.
--
-- RLS is bypassed by the service role. Triggers are not. So the engine could
-- open a shift and never close it, and it only console.error'd the failure.
-- Worse, schema_v8's shifts_no_overlap treats an open shift as running to
-- infinity, so the next day's clock-in collided with yesterday's shift that
-- never ended — and the worker silently stopped being tracked entirely.
--
-- Verified before the fix: a service-role PATCH setting ended_at returned
-- 400 P0001 and the row was unchanged.

create or replace function shifts_worker_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No auth.uid() means this is the service role: the geofence engine, or a
  -- migration. Nothing else can reach this table without a JWT, because RLS
  -- stops it long before the trigger runs. The engine is the system of record
  -- for times — it is the one writer that MUST be able to set ended_at.
  if auth.uid() is null then
    return new;
  end if;

  if current_is_office() then
    return new;
  end if;

  if new.started_at  is distinct from old.started_at
     or new.ended_at is distinct from old.ended_at
     or new.site_id  is distinct from old.site_id
     or new.worker_id is distinct from old.worker_id
     or new.source   is distinct from old.source
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by then
    raise exception 'A worker can set the cost code and break on their own open shift, nothing else';
  end if;
  return new;
end $$;

-- --------------------------------------------------- the shifts left behind

-- Every shift opened while the guard was refusing to close them is still open,
-- and each one blocks that worker's next clock-in through shifts_no_overlap.
-- A shift that has been open longer than sixteen hours was not worked; it was
-- stranded. Close it at the worker's last known position rather than now, so
-- the hours are the least wrong they can be, and mark it edited so the office
-- can see it was not a clean punch.
update shifts s
   set ended_at = coalesce(
         (select max(p.at) from positions p
           where p.worker_id = s.worker_id
             and p.at between s.started_at and s.started_at + interval '16 hours'),
         s.started_at + interval '8 hours'
       ),
       edited = true
 where s.ended_at is null
   and s.started_at < now() - interval '16 hours';

import { useEffect, useState } from 'react'
import { supabase } from '../data/supabase'

export interface WorkerSite {
  id: string
  name: string
  lat: number
  lng: number
  radiusM: number
}

/**
 * The job sites this worker can see, read straight from the table.
 *
 * The tracker only learns the site list by pinging `/api/ping`, so its copy is
 * empty until the worker taps Start tracking. Tabs are not consequences of
 * being on the clock — checking last week's hours or Tuesday's photos on the
 * couch should not require switching your GPS on — and a tab that used the
 * tracker's list showed every job as "Unassigned" until it did.
 *
 * RLS already scopes this to the worker's own company.
 */
export function useSites(fallback: WorkerSite[] = []): WorkerSite[] {
  const [sites, setSites] = useState<WorkerSite[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase().from('job_sites').select('id,name,lat,lng,radius_m').order('name')
      if (cancelled) return
      setSites(
        ((data ?? []) as Array<{ id: string; name: string; lat: number; lng: number; radius_m: number }>).map((s) => ({
          id: s.id,
          name: s.name,
          lat: Number(s.lat),
          lng: Number(s.lng),
          radiusM: Number(s.radius_m),
        })),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return sites.length > 0 ? sites : fallback
}

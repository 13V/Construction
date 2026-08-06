import { useState } from 'react'
import { supabase } from '../data/supabase'
import { theme } from '../theme'
import type { JobSite, LatLng } from '../types'

/**
 * Job site management. Placing a geofence reuses the dashboard's existing map
 * rather than opening a second one — clicking the map sets the centre, and the
 * radius slider drives the draft circle drawn there. A second <Map> would be a
 * second billable load every time this screen opened.
 */

interface Draft {
  id: string | null
  name: string
  address: string
  jobType: string
  status: 'active' | 'starting_soon'
  radiusM: number
  budget: string
  center: LatLng | null
}

const empty: Draft = {
  id: null,
  name: '',
  address: '',
  jobType: '',
  status: 'active',
  radiusM: 150,
  budget: '',
  center: null,
}

const field = {
  width: '100%',
  height: 32,
  padding: '0 9px',
  marginTop: 4,
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  font: 'inherit',
  fontSize: 13,
  color: theme.ink,
} as const

const label = {
  display: 'block',
  marginTop: 12,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase' as const,
  color: theme.inkFaint,
}

interface JobSitesProps {
  sites: JobSite[]
  draft: Draft | null
  onDraftChange: (draft: Draft | null) => void
  onSaved: () => void
  canEdit: boolean
}

export function JobSites({ sites, draft, onDraftChange, onSaved, canEdit }: JobSitesProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (changes: Partial<Draft>) =>
    onDraftChange({ ...(draft ?? empty), ...changes })

  /**
   * Photon (OpenStreetMap) — keyless, like the map tiles. Results are biased
   * toward wherever the existing sites are, which matters because street names
   * repeat across cities. Clicking the map is always the fallback.
   */
  async function findAddress() {
    const query = draft?.address.trim()
    if (!query) return
    setError(null)
    setBusy(true)

    const bias = draft?.center ?? sites[0]?.center
    const params = new URLSearchParams({ q: query, limit: '1' })
    if (bias) {
      params.set('lat', String(bias.lat))
      params.set('lon', String(bias.lng))
    }

    try {
      const res = await fetch(`https://photon.komoot.io/api/?${params}`)
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as {
        features: Array<{
          geometry: { coordinates: [number, number] }
          properties: Record<string, string>
        }>
      }
      const hit = data.features?.[0]
      if (!hit) {
        setError('No match for that address — click the map to drop the pin instead.')
        return
      }
      const [lng, lat] = hit.geometry.coordinates
      const p = hit.properties
      const label = [
        [p.housenumber, p.street].filter(Boolean).join(' ') || p.name,
        p.city ?? p.district,
        p.state,
        p.postcode,
      ]
        .filter(Boolean)
        .join(', ')
      patch({ center: { lat, lng }, address: label || query })
    } catch {
      setError('Address lookup failed — click the map to drop the pin instead.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft?.name.trim() || !draft.center) {
      setError('A name and a location on the map are both required.')
      return
    }
    setBusy(true)
    setError(null)

    const row = {
      name: draft.name.trim(),
      address: draft.address.trim(),
      job_type: draft.jobType.trim(),
      status: draft.status,
      lat: draft.center.lat,
      lng: draft.center.lng,
      radius_m: draft.radiusM,
      budget: draft.budget.trim() === '' ? null : Number(draft.budget),
    }

    const client = supabase()
    const { error: err } = draft.id
      ? await client.from('job_sites').update(row).eq('id', draft.id)
      : await client.from('job_sites').insert(row)

    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onDraftChange(null)
    onSaved()
  }

  async function archive(id: string) {
    setBusy(true)
    const { error: err } = await supabase()
      .from('job_sites')
      .update({ status: 'archived' })
      .eq('id', id)
    setBusy(false)
    if (err) setError(err.message)
    else onSaved()
  }

  return (
    <div
      style={{
        width: 340,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: theme.panel,
        borderRight: `1px solid ${theme.border}`,
      }}
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          padding: '11px 14px',
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>Job sites</span>
        <span style={{ marginLeft: 8, color: theme.inkFaint, fontSize: 12 }}>
          {sites.length}
        </span>
        {canEdit && !draft && (
          <button
            onClick={() => onDraftChange(empty)}
            style={{
              marginLeft: 'auto',
              padding: '5px 11px',
              borderRadius: 3,
              border: 'none',
              background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
              color: theme.ink,
              font: 'inherit',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '.04em',
              cursor: 'pointer',
            }}
          >
            NEW SITE
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {draft ? (
          <div style={{ padding: 14 }}>
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 4,
                background: draft.center ? theme.accentFill : '#FFF6DF',
                fontSize: 11.5,
                color: draft.center ? theme.accent : '#8A6100',
                lineHeight: 1.4,
              }}
            >
              {draft.center
                ? 'Click the map to move the pin. The yellow circle is the geofence.'
                : 'Click on the map to drop the pin, or search an address below.'}
            </div>

            <label style={label}>
              Site name
              <input
                style={field}
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Maple Ridge"
              />
            </label>

            <label style={label}>
              Address
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={field}
                  value={draft.address}
                  onChange={(e) => patch({ address: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void findAddress()
                    }
                  }}
                  placeholder="4412 Sandgate Rd, Nundah QLD"
                />
                <button onClick={() => void findAddress()} style={ghost}>
                  Find
                </button>
              </div>
            </label>

            <label style={label}>
              Budget — what the job is costed against
              <input
                style={field}
                value={draft.budget}
                onChange={(e) => patch({ budget: e.target.value })}
                placeholder="65000"
                inputMode="decimal"
              />
            </label>

            <label style={label}>
              Job type
              <input
                style={field}
                value={draft.jobType}
                onChange={(e) => patch({ jobType: e.target.value })}
                placeholder="Custom home — framing"
              />
            </label>

            <label style={label}>
              Status
              <select
                style={field}
                value={draft.status}
                onChange={(e) => patch({ status: e.target.value as Draft['status'] })}
              >
                <option value="active">Active</option>
                <option value="starting_soon">Starting soon</option>
              </select>
            </label>

            <label style={label}>
              Geofence radius — {draft.radiusM} m ({Math.round(draft.radiusM * 3.28084)} ft)
              <input
                type="range"
                min={25}
                max={600}
                step={5}
                value={draft.radiusM}
                onChange={(e) => patch({ radiusM: Number(e.target.value) })}
                style={{ width: '100%', marginTop: 8 }}
              />
            </label>
            <p style={{ fontSize: 11, color: theme.inkSoft, lineHeight: 1.45 }}>
              Big enough to cover the whole site and any parking, small enough not to
              reach the road. Crew parked outside it get flagged rather than clocked in.
            </p>

            {error && (
              <div style={{ marginTop: 10, fontSize: 12, color: theme.alert }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={() => void save()} disabled={busy} style={primary}>
                {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Create site'}
              </button>
              <button onClick={() => onDraftChange(null)} style={ghost}>
                Cancel
              </button>
              {draft.id && (
                <button
                  onClick={() => void archive(draft.id!)}
                  style={{ ...ghost, marginLeft: 'auto', color: theme.alert }}
                >
                  Archive
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {sites.length === 0 && (
              <div style={{ padding: 20, fontSize: 13, color: theme.inkSoft, lineHeight: 1.6 }}>
                No job sites yet. Add one and drop its geofence on the map — crew
                start clocking in automatically as soon as a site exists.
              </div>
            )}
            {sites.map((site) => (
              <button
                key={site.id}
                onClick={() =>
                  canEdit &&
                  onDraftChange({
                    id: site.id,
                    name: site.name,
                    address: site.address,
                    jobType: site.jobType,
                    status: site.status === 'starting_soon' ? 'starting_soon' : 'active',
                    radiusM: site.radiusM,
                    budget: site.budget === null ? '' : String(site.budget),
                    center: site.center,
                  })
                }
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px 14px',
                  border: 'none',
                  borderBottom: `1px solid ${theme.border}`,
                  background: 'transparent',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: canEdit ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background:
                        site.status === 'active' ? theme.success : theme.inkFaint,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{site.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.inkFaint }}>
                    {site.radiusM} m
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: theme.inkSoft, marginTop: 2 }}>
                  {site.address || 'No address'}
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

export type { Draft as JobSiteDraft }
export { empty as emptyDraft }

const ghost = {
  padding: '6px 11px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
}

const primary = {
  padding: '6px 14px',
  borderRadius: 3,
  border: 'none',
  background: `linear-gradient(90deg, ${theme.ctaFrom}, ${theme.ctaTo})`,
  color: theme.ink,
  font: 'inherit',
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}

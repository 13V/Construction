/**
 * Who the job is for: the builder box, and what picking a builder does to
 * other jobs.
 *
 * The list is every builders row plus every builder name typed on a job
 * (the phone's New project sheet and Project details only ever write the
 * name), each with how many jobs it is on, so "Paramoint (1 job)" is found
 * whether or not anyone ever made it a record. Names match case aside; a
 * spelling that matches a record is saved as the record spells it, so the
 * job and the record never disagree (data/builders.ts).
 *
 * "Also link N other jobs with this builder name": jobs that go by the
 * same name but are not linked to its record, usually because the phone
 * made them. Linking them is what makes the builder's people (project
 * manager, site supervisor) show on those jobs too. Checked by default and
 * listed by name, so nobody links a job they did not see.
 *
 * Editing a job whose phone-side name no longer matches its record (the
 * phone's Project details renames client_name and leaves the record alone)
 * shows a banner instead of fixing it quietly: either the phone's name or
 * the record's could be the right one.
 */
import { useId } from 'react'
import type { BuilderSuggestion } from '../../data/builders'
import { addressLine } from '../../phone'
import { color, radius, space, text } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button } from '../../ui/Button'
import { Combobox } from '../../ui/Combobox'
import type { FormMode, FormSite, ResolvedBuilder } from './useJobForm'

export interface BuilderFieldProps {
  mode: FormMode
  value: string
  onChange: (text: string) => void
  onPick: (suggestion: BuilderSuggestion | null) => void
  suggestions: BuilderSuggestion[]
  resolved: ResolvedBuilder
  /** Editing: the job is moving to another builder (or off one, or onto a record for the first time). */
  changed: boolean
  /**
   * Editing: a different builder, or none; not the same builder linked to its
   * record or given the record's spelling. Only this takes the job's own site
   * supervisor off.
   */
  switched: boolean
  /** Editing: the job had its own site supervisor, which a change of builder takes off. */
  hadSupervisor: boolean
  /** Editing: the phone's name for the builder differs from the record's. */
  drift: { onJob: string; record: string } | null
  candidates: FormSite[]
  linkOthers: boolean
  onLinkOthers: (link: boolean) => void
  /** The builder list could not be loaded. */
  loadError: string | null
  error?: string
}

const jobs = (n: number) => `${n} job${n === 1 ? '' : 's'}`
const SHOW_JOBS = 6

export function BuilderField({
  mode,
  value,
  onChange,
  onPick,
  suggestions,
  resolved,
  changed,
  switched,
  hadSupervisor,
  drift,
  candidates,
  linkOthers,
  onLinkOthers,
  loadError,
  error,
}: BuilderFieldProps) {
  const id = useId()
  const sug = resolved.suggestion
  const typed = value.trim().replace(/\s+/g, ' ')

  // A name on the list is saved as it is spelled there (resolved.name), whatever the case typed: say so when they differ.
  const respelled = !!typed && resolved.name !== typed
  let hint: string
  if (!typed) hint = mode === 'edit' && changed ? 'Saving takes the builder off this job.' : 'Who the job is for. Optional.'
  else if (resolved.original) hint = respelled ? `This job’s builder, kept as “${resolved.name}”, as the phones show it.` : sug ? `On ${jobs(sug.jobs.length)}.` : 'This job’s builder.'
  else if (sug?.builderId) hint = respelled ? `Saved as “${resolved.name}”, the name on file (${jobs(sug.jobs.length)}).` : `On file, on ${jobs(sug.jobs.length)}.`
  else if (sug)
    hint = respelled
      ? `Saved as “${resolved.name}”, as it is typed on ${jobs(sug.jobs.length)}. There is no builder record yet: saving makes one.`
      : `Typed on ${jobs(sug.jobs.length)}, with no builder record yet. Saving makes one.`
  else hint = 'A new builder. Saving adds them.'
  // Only a real change of builder takes the supervisor off; the same builder linked or respelled keeps them (builderPatch).
  if (mode === 'edit' && switched && hadSupervisor) hint += typed ? ' This job’s site supervisor comes off it: they are the old builder’s.' : ' Its site supervisor comes off it too.'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
      <Combobox
        id={`${id}-builder`}
        name="builder"
        // The card it sits in is titled Builder; the label is for a screen reader.
        label="Builder"
        hideLabel
        value={value}
        onChange={(t) => {
          onChange(t)
          onPick(null)
        }}
        onPick={(o) => onPick(suggestions.find((s) => (s.builderId ?? `name:${s.name}`) === o.value) ?? null)}
        options={suggestions.map((s) => ({ value: s.builderId ?? `name:${s.name}`, label: s.name, detail: jobs(s.jobs.length) }))}
        placeholder="Who the job is for"
        hint={loadError ? `The builder list could not be loaded (${loadError}). Type the name; a builder already on file is still found.` : hint}
        error={error}
      />

      {drift && resolved.original && (
        <Banner
          tone="warn"
          title="The phones show a different name"
          action={
            <Button size="sm" onClick={() => onChange(drift.record)} data-use-record="">
              Use “{drift.record}”
            </Button>
          }
        >
          The crew’s phones call this job’s builder “{drift.onJob}”, but it is linked to the builder record “{drift.record}”. Somebody renamed it on a phone. Use the
          record’s name to make them agree, or pick the right builder.
        </Banner>
      )}

      {candidates.length > 0 && (
        <div data-link-others="" style={{ display: 'flex', flexDirection: 'column', gap: space.xs, padding: `${space.sm}px ${space.md}px`, background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.md }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: space.xs, cursor: 'pointer', ...text.base, color: color.ink }}>
            <input
              type="checkbox"
              className="wb-focus"
              checked={linkOthers}
              onChange={(e) => onLinkOthers(e.target.checked)}
              data-link-others-box=""
              style={{ flex: 'none', width: 16, height: 16, margin: '2px 0 0', accentColor: color.ink }}
            />
            <span>
              Also link {candidates.length === 1 ? '1 other job' : `${candidates.length} other jobs`} with this builder name
              <span style={{ display: 'block', ...text.sm, color: color.muted }}>So {resolved.name}’s people show on {candidates.length === 1 ? 'it' : 'them'} too.</span>
            </span>
          </label>
          <ul style={{ margin: 0, paddingLeft: space.lg + 4, display: 'flex', flexDirection: 'column', gap: 2, ...text.sm, color: color.body }}>
            {candidates.slice(0, SHOW_JOBS).map((j) => {
              const where = addressLine({ name: j.name, address: j.address ?? '' })
              return (
                <li key={j.id} data-link-job={j.id}>
                  {where || j.name}
                  {where ? <span style={{ color: color.muted }}> · {j.name}</span> : null}
                  {j.status === 'archived' ? <span style={{ color: color.muted }}> · archived</span> : null}
                </li>
              )
            })}
            {candidates.length > SHOW_JOBS && <li style={{ color: color.muted }}>and {candidates.length - SHOW_JOBS} more</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

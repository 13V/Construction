/**
 * The builder's people on this job: project manager, site supervisor,
 * contract administrator, each with a name, a mobile and an email. The
 * phone's Project details shows exactly these three, with call and email
 * buttons, and its Safety and Waterproofing screens email the job's SWMS and
 * certificates to the site supervisor.
 *
 * They belong to the builder, not the job (data/builders.ts), and the
 * fields say so where it matters:
 *  - The project manager and contract administrator are one each per
 *    builder. Their fields show the builder's one person on file, and
 *    typing over them changes that person on every job for the builder, so
 *    the hint says that, naming who is being replaced.
 *  - The site supervisor is this job's own. The list offers the builder's
 *    supervisors already on file; a new name adds one.
 * Nothing here writes: useJobForm saves them, after the job.
 */
import { useId } from 'react'
import { sameName, type ContactRow } from '../../data/builders'
import { CONTACT_LABEL, CONTACT_ROLES, ONE_PER_BUILDER, type ContactRole } from '../../data/contract'
import { color, radius, space, text } from '../../tokens'
import { Combobox } from '../../ui/Combobox'
import { Field } from '../../ui/Field'
import { asContact, sameContact, type Contacts, type ContactValue, type FieldErrors, type FormMode, type OnFile } from './useJobForm'

export interface ContactsFieldsProps {
  mode: FormMode
  /** The builder in the box, tidied; '' for none. */
  builderName: string
  values: Contacts
  onChange: (role: ContactRole, value: ContactValue) => void
  /** Who is on file for the builder in the box; null while their people load. */
  onFile: OnFile | null
  /** The builder's site supervisors, offered for this job's. */
  supervisors: ContactRow[]
  /** Editing a job with no site supervisor of its own: whom the phone shows instead (the builder's first). */
  fallbackSupervisor: ContactRow | null
  errors: FieldErrors
  /** The builder's people could not be loaded. */
  loadError: string | null
}

export function ContactsFields({ mode, builderName, values, onChange, onFile, supervisors, fallbackSupervisor, errors, loadError }: ContactsFieldsProps) {
  const noBuilder = !builderName
  const loading = !noBuilder && onFile === null
  const builder = builderName || 'the builder'

  return (
    <div data-contacts="" style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <p style={{ margin: 0, ...text.sm, color: color.muted }}>
        {noBuilder
          ? 'Type the builder first: these people are the builder’s, not the job’s.'
          : `Contacts belong to ${builder} and show on every ${builder} job. The site supervisor is this job’s own.`}
        {loading && ` Loading ${builder}’s people…`}
      </p>
      {loadError && <p style={{ margin: 0, ...text.sm, color: color.amber }}>{builder}’s people on file could not be loaded ({loadError}). Anyone typed is still saved, matched by name.</p>}
      {CONTACT_ROLES.map((role) => (
        <Person
          key={role}
          role={role}
          mode={mode}
          builder={builder}
          value={values[role]}
          onChange={(v) => onChange(role, v)}
          holder={onFile?.[role] ?? null}
          supervisors={role === 'supervisor' ? supervisors : []}
          fallback={role === 'supervisor' ? fallbackSupervisor : null}
          error={errors[`contact.${role}`]}
          disabled={noBuilder || loading}
        />
      ))}
    </div>
  )
}

function Person({
  role,
  mode,
  builder,
  value,
  onChange,
  holder,
  supervisors,
  fallback,
  error,
  disabled,
}: {
  role: ContactRole
  mode: FormMode
  builder: string
  value: ContactValue
  onChange: (v: ContactValue) => void
  holder: ContactRow | null
  supervisors: ContactRow[]
  fallback: ContactRow | null
  error?: string
  disabled: boolean
}) {
  const id = useId()
  const label = CONTACT_LABEL[role]
  const lower = label.toLowerCase()
  const name = value.name.trim()
  const changed = !sameContact(value, asContact(holder))
  const set = (patch: Partial<ContactValue>) => onChange({ ...value, ...patch })

  // What saving this person will do, when it is more than it looks.
  let note: { text: string; tone: 'muted' | 'amber' } | null = null
  if (ONE_PER_BUILDER.includes(role) && holder && changed) {
    if (!name) {
      note =
        mode === 'edit'
          ? { text: `Saving removes ${holder.name} as the ${lower} from every job for ${builder}.`, tone: 'amber' }
          : { text: `${holder.name} stays the ${lower} for ${builder}: a new job removes nobody.`, tone: 'muted' }
    } else if (!sameName(holder.name, name)) {
      note = { text: `Saving makes ${name} the ${lower} on every job for ${builder}, in place of ${holder.name}.`, tone: 'amber' }
    } else {
      note = { text: `Saving updates ${holder.name}’s details on every job for ${builder}.`, tone: 'muted' }
    }
  } else if (ONE_PER_BUILDER.includes(role) && holder && !changed) {
    note = { text: `On file for ${builder}: the ${lower} on every job for them.`, tone: 'muted' }
  } else if (role === 'supervisor' && holder && !name) {
    note = { text: `Saving takes ${holder.name} off this job. They stay on file for ${builder}.`, tone: 'muted' }
  } else if (role === 'supervisor' && !holder && !name && fallback) {
    note = {
      text: `The crew’s phones show ${fallback.name} here, ${builder}’s first site supervisor, but SWMS and certificates are only emailed to a job’s own. Pick them, or someone else.`,
      tone: 'amber',
    }
  }

  const nameField =
    role === 'supervisor' ? (
      <Combobox
        id={`${id}-name`}
        name={`${role}.name`}
        label={label}
        optional
        hideLabel
        value={value.name}
        disabled={disabled}
        placeholder="Name"
        onChange={(t) => set({ name: t })}
        onPick={(o) => {
          const c = supervisors.find((s) => s.id === o.value)
          if (c) onChange({ name: c.name, mobile: c.mobile ?? '', email: c.email ?? '' })
        }}
        options={supervisors.map((s) => ({ value: s.id, label: s.name, detail: s.mobile ?? s.email ?? undefined }))}
      />
    ) : (
      <Field
        id={`${id}-name`}
        name={`${role}.name`}
        label={label}
        hideLabel
        value={value.name}
        disabled={disabled}
        placeholder="Name"
        autoComplete="off"
        onChange={(e) => set({ name: e.target.value })}
      />
    )

  return (
    <fieldset
      data-contact={role}
      disabled={disabled}
      style={{ margin: 0, padding: `${space.sm}px ${space.md}px ${space.md}px`, minWidth: 0, display: 'flex', flexDirection: 'column', gap: space.xs, border: `1px solid ${error ? color.redEdge : color.borderSoft}`, borderRadius: radius.md }}
    >
      <legend style={{ padding: '0 4px', marginLeft: -4, ...text.label, color: color.muted }}>{label}</legend>
      {nameField}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: space.xs }}>
        <Field
          label={`${label} mobile`}
          hideLabel
          name={`${role}.mobile`}
          type="tel"
          value={value.mobile}
          disabled={disabled}
          placeholder="Mobile"
          autoComplete="off"
          onChange={(e) => set({ mobile: e.target.value })}
        />
        <Field
          label={`${label} email`}
          hideLabel
          name={`${role}.email`}
          type="email"
          value={value.email}
          disabled={disabled}
          placeholder="Email"
          autoComplete="off"
          onChange={(e) => set({ email: e.target.value })}
        />
      </div>
      {error ? (
        <div role="alert" style={{ ...text.sm, color: color.red }}>
          {error}
        </div>
      ) : note ? (
        <div data-contact-note="" style={{ ...text.sm, color: note.tone === 'amber' ? color.amber : color.muted }}>
          {note.text}
        </div>
      ) : role === 'supervisor' ? (
        <div style={{ ...text.sm, color: color.muted }}>SWMS and waterproofing certificates for this job are emailed here.</div>
      ) : null}
    </fieldset>
  )
}

/**
 * Add a supplier invoice, or a cost, to the job: the phone's ReceiptScreen
 * (ADD INVOICE and ADD A COST on its Money tab) at a desk.
 *
 * Everything that reaches the database is the phone's, from data/money.ts
 * and pinned to the phone's source by money.test.ts: the file goes into the
 * receipts bucket under <company>/<job>/; it is sent to the phone's reader
 * (/api/parse-receipt), which fills the form in and marks what it read; the
 * row is the phone's expenses row, status needs_review. What is different is
 * what a desk has instead of a camera:
 *  - a supplier invoice is dropped or chosen as a file, a PDF as well as a
 *    photo (the reader takes both; the phone's camera only makes photos)
 *  - "Add a cost" opens on the fields, with the file optional, as the
 *    phone's does
 *  - the job is this one; the phone's form asks which job
 *  - the row is read back after it is saved, and a file that nothing was
 *    saved against (the drawer cancelled, the file swapped) is taken back
 *    out of storage; the phone leaves those behind
 */
import { useEffect, useRef, useState } from 'react'
import { WEB_BRAND } from '../../marker'
import { addressLine, type JobSiteRow, type WorkerRow } from '../../phone'
import { color, radius, space, text } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button, CloseIcon, IconButton } from '../../ui/Button'
import { Drawer } from '../../ui/Drawer'
import { accepts, DropZone } from '../../ui/DropZone'
import { Field } from '../../ui/Field'
import { Select } from '../../ui/Select'
import {
  blankCost,
  costProblem,
  discardReceipt,
  editCost,
  EXPENSE_CATEGORIES,
  fileBase64,
  mediaTypeOf,
  readerRefusal,
  readReceipt,
  RECEIPT_ACCEPT,
  RECEIPT_MAX_BYTES,
  saveCost,
  sectionOfCategory,
  uploadReceipt,
  withReading,
  type CostForm,
  type SavedCost,
} from '../../data/money'

export type CostMode = 'invoice' | 'cost'

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A size as a person says it. */
const sizeOf = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${Math.round((n / 1024 / 1024) * 10) / 10} MB`)

export interface CostDrawerProps {
  /** Which button opened it; null when closed. Give it a new key each time it opens. */
  mode: CostMode | null
  me: WorkerRow
  site: JobSiteRow
  onClose: () => void
  onSaved: (saved: SavedCost) => void
}

export function CostDrawer({ mode, me, site, onClose, onSaved }: CostDrawerProps) {
  const [form, setForm] = useState<CostForm>(() => blankCost())
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  /** "Uploading x…" or "Reading x…" while either is under way. */
  const [busy, setBusy] = useState<string | null>(null)
  /** Why the file was not read, or was read with nothing to fill in. Not an error: the form still works. */
  const [readNote, setReadNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** Moves on every close, so an upload or a read that answers after it is dropped. */
  const visit = useRef(0)
  /** The file in storage that nothing has been saved against yet. */
  const unsaved = useRef<string | null>(null)

  // Gone from the page with a file nothing was saved against (another tab,
  // another job): it goes back out of storage, and an upload still under way
  // is told so when it lands.
  useEffect(
    () => () => {
      visit.current += 1
      if (unsaved.current) void discardReceipt(unsaved.current)
      unsaved.current = null
    },
    [],
  )

  // A new error is scrolled to: the Save button is pinned below, the message is at the top.
  const errorBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) errorBox.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  const invoice = mode === 'invoice'
  const edit = <K extends keyof CostForm>(key: K, value: CostForm[K]) => {
    setError(null)
    setForm((f) => editCost(f, key, value))
  }

  const close = () => {
    if (saving) return
    visit.current += 1
    if (unsaved.current) void discardReceipt(unsaved.current)
    unsaved.current = null
    onClose()
  }

  async function take(picked: File) {
    const mine = visit.current
    setError(null)
    setReadNote(null)
    setBusy(`Uploading ${picked.name}…`)
    let path: string
    try {
      path = await uploadReceipt(me, site.id, picked)
    } catch (e) {
      if (mine !== visit.current) return
      setBusy(null)
      setError(`${picked.name} did not upload: ${why(e)}`)
      return
    }
    if (mine !== visit.current) {
      // Closed while it went up: nothing will be saved against it.
      void discardReceipt(path)
      return
    }
    if (unsaved.current) void discardReceipt(unsaved.current)
    unsaved.current = path
    setFile({ name: picked.name, size: picked.size })
    setForm((f) => ({ ...f, receiptPath: path }))

    const refusal = readerRefusal(picked)
    if (refusal) {
      setBusy(null)
      setReadNote(refusal)
      return
    }
    setBusy(`Reading ${picked.name}…`)
    try {
      const parsed = await readReceipt({ base64: await fileBase64(picked), mediaType: mediaTypeOf(picked), siteName: site.name })
      if (mine !== visit.current) return
      if (parsed) setForm((f) => withReading(f, parsed))
      else setReadNote('Attached. Reading files is not set up yet, so fill in the details below.')
    } catch (e) {
      if (mine !== visit.current) return
      setReadNote(`Could not read ${picked.name} automatically: ${why(e)}. Enter the details by hand.`)
    } finally {
      if (mine === visit.current) setBusy(null)
    }
  }

  const removeFile = () => {
    if (unsaved.current) void discardReceipt(unsaved.current)
    unsaved.current = null
    setFile(null)
    setReadNote(null)
    setForm((f) => ({ ...f, receiptPath: null }))
  }

  async function save() {
    const problem = costProblem(form)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await saveCost({ me, siteId: site.id, form })
      // The file is the expense's now.
      unsaved.current = null
      onSaved(saved)
    } catch (e) {
      const message = why(e)
      // Saved but not as entered: the row has the file, so it stays.
      if (/^It saved/.test(message)) unsaved.current = null
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  const marked = (key: string) =>
    form.aiFilled.has(key) ? (
      <span data-ai-mark="" style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: 0, textTransform: 'none', color: color.body }}>
        {' '}
        · read from the file
      </span>
    ) : null

  const fileBox = file ? (
    <div data-cost-file="" style={{ display: 'flex', alignItems: 'center', gap: space.xs, padding: `${space.xs}px ${space.xs}px ${space.xs}px ${space.sm}px`, background: color.rowFill, border: `1px solid ${color.borderSoft}`, borderRadius: radius.md }}>
      <span style={{ flex: 1, minWidth: 0, ...text.sm, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.name} <span style={{ color: color.muted }}>{sizeOf(file.size)}</span>
      </span>
      <IconButton label="Take this file off" size={28} onClick={removeFile} disabled={!!busy || saving}>
        <CloseIcon size={12} />
      </IconButton>
    </div>
  ) : (
    <DropZone
      multiple={false}
      compact={!invoice}
      accept={RECEIPT_ACCEPT}
      maxBytes={RECEIPT_MAX_BYTES}
      disabled={!!busy || saving}
      onFiles={(f) => f[0] && void take(f[0])}
      onReject={(r) => setError(`Not attached. ${r[0]!.reason}${accepts(r[0]!.file, RECEIPT_ACCEPT) ? '' : ' Attach a PDF or a photo.'}`)}
      label={invoice ? 'Drop the supplier’s invoice here' : 'Attach the receipt, if there is one'}
      hint={`A PDF or a photo. ${WEB_BRAND} reads it and fills in the form for you to check.`}
      buttonLabel={invoice ? 'Choose the file' : 'Choose a file'}
    />
  )

  const status = (
    <>
      {busy && (
        <div role="status" data-cost-busy="" style={{ ...text.sm, color: color.muted }}>
          {busy}
        </div>
      )}
      {readNote && (
        <div role="status" data-cost-note="" style={{ ...text.sm, color: color.body }}>
          {readNote}
        </div>
      )}
      {form.aiExtracted && !busy && (
        <Banner title={`Read from ${file?.name ?? 'the file'}`}>
          <span data-cost-read="">
            {form.aiConfidence != null ? `${Math.round(form.aiConfidence * 100)}% sure. ` : ''}Check every field below before you save.
            {form.aiNote ? ` ${form.aiNote}` : ''}
          </span>
        </Banner>
      )}
    </>
  )

  const fields = (
    <>
      <Field label={<>Vendor{marked('vendor')}</>} name="vendor" value={form.vendor} onChange={(e) => edit('vendor', e.target.value)} placeholder="Bunnings" autoComplete="off" maxLength={200} />
      <Field label={<>Date{marked('spentOn')}</>} name="spentOn" type="date" value={form.spentOn} onChange={(e) => edit('spentOn', e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space.sm }}>
        <Field label={<>Amount{marked('amount')}</>} name="amount" inputMode="decimal" value={form.amount} onChange={(e) => edit('amount', e.target.value)} placeholder="0.00" hint="The total, with GST" autoComplete="off" />
        <Field label={<>GST{marked('tax')}</>} name="tax" inputMode="decimal" value={form.tax} onChange={(e) => edit('tax', e.target.value)} placeholder="0.00" hint="Blank if there is none" autoComplete="off" />
      </div>
      <Select
        label={<>Category{marked('category')}</>}
        name="category"
        value={form.category}
        onChange={(e) => edit('category', e.target.value)}
        placeholder="—"
        options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
        hint={form.category ? `Shows under ${sectionOfCategory(form.category)}.` : 'Subcontractor shows under Contractors & wages, anything else under Materials & hire.'}
      />
      {form.lineItems.length > 0 && (
        <div data-cost-lines="" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: `0 0 ${space.xxs}px`, ...text.label, color: color.muted }}>Lines read from the file</h3>
          {form.lineItems.map((li, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: space.sm, padding: `${space.xs - 2}px 0`, borderBottom: `1px solid ${color.borderSoft}`, ...text.sm }}>
              <span style={{ color: color.body, minWidth: 0, overflowWrap: 'anywhere' }}>{li.description}</span>
              <span style={{ fontWeight: 600, color: color.ink, fontVariantNumeric: 'tabular-nums' }}>${Number(li.amount).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )

  return (
    <Drawer
      open={mode !== null}
      title={invoice ? 'Add a supplier invoice' : 'Add a cost'}
      subtitle={`Against ${addressLine(site) || site.name}`}
      onClose={close}
      footer={
        <>
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={!!busy} onClick={() => void save()} data-cost-save="">
            {invoice ? 'Save invoice' : 'Save cost'}
          </Button>
        </>
      }
    >
      <form data-cost-drawer={mode ?? ''} onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        {error && (
          <div ref={errorBox}>
            {/* Each message says what did not happen: not saved, not uploaded, not attached. */}
            <Banner tone="error">
              <span data-cost-error="">{error}</span>
            </Banner>
          </div>
        )}
        {invoice ? (
          <>
            {fileBox}
            {status}
            {fields}
          </>
        ) : (
          <>
            {fields}
            <div style={{ display: 'flex', flexDirection: 'column', gap: space.xs }}>
              <span style={{ ...text.label, color: color.muted }}>Receipt</span>
              {fileBox}
            </div>
            {status}
          </>
        )}
        <div style={{ ...text.xs, color: color.muted }}>
          It counts on this job straight away, on the website and on the crew app’s Money tab, ex GST.
        </div>
      </form>
    </Drawer>
  )
}

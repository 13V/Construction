/**
 * Where files go: drop them on it, or press "Choose files" (a real button,
 * so a keyboard can attach a file too).
 *
 * It checks before anything is sent: a file over `maxBytes`, or not of the
 * `accept` types, is handed to onReject with the reason, and never reaches
 * onFiles. The phone caps uploads at 25 MB; callers pass that in.
 *
 *   <DropZone accept="application/pdf,image/*" maxBytes={25 * 1024 * 1024}
 *     onFiles={upload} onReject={(r) => toast(r.map((x) => x.reason).join(' '))} />
 */
import { useId, useRef, useState, type ReactNode } from 'react'
import { color, radius, space, text } from '../tokens'
import { Button } from './Button'

export interface Rejected {
  file: File
  reason: string
}

export interface DropZoneProps {
  onFiles: (files: File[]) => void
  onReject?: (rejected: Rejected[]) => void
  /** As the input's accept: 'application/pdf,image/*', '.pdf,.png'. */
  accept?: string
  multiple?: boolean
  maxBytes?: number
  disabled?: boolean
  /** The line in the middle. */
  label?: ReactNode
  /** The line under it: types and size. */
  hint?: ReactNode
  /** One line, for a table cell. */
  compact?: boolean
  buttonLabel?: string
}

/** A size as a person says it: kB under a megabyte, else MB to one place. */
const sizeOf = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} kB` : `${Math.round((n / 1024 / 1024) * 10) / 10} MB`)

/** Whether a file matches an accept string the way the file picker would. */
export function accepts(file: File, accept: string | undefined): boolean {
  if (!accept) return true
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return accept
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? type.startsWith(a.slice(0, -1)) : type === a))
}

/** Split files into the ones to send and the ones to refuse, with the reason in words. */
export function screenFiles(files: File[], { accept, maxBytes }: { accept?: string; maxBytes?: number }) {
  const ok: File[] = []
  const rejected: Rejected[] = []
  for (const file of files) {
    if (!accepts(file, accept)) rejected.push({ file, reason: `${file.name} is not a type this takes.` })
    else if (maxBytes !== undefined && file.size > maxBytes) rejected.push({ file, reason: `${file.name} is ${sizeOf(file.size)}; the limit is ${sizeOf(maxBytes)}.` })
    else ok.push(file)
  }
  return { ok, rejected }
}

export function DropZone({
  onFiles,
  onReject,
  accept,
  multiple = true,
  maxBytes,
  disabled = false,
  label = 'Drop files here',
  hint,
  compact = false,
  buttonLabel = multiple ? 'Choose files' : 'Choose a file',
}: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const [over, setOver] = useState(false)
  // dragenter/dragleave fire for every child crossed; count them so the
  // highlight does not flicker off over the button.
  const depth = useRef(0)

  const take = (list: FileList | null) => {
    if (!list || disabled) return
    const files = Array.from(list).slice(0, multiple ? undefined : 1)
    const { ok, rejected } = screenFiles(files, { accept, maxBytes })
    if (rejected.length) onReject?.(rejected)
    if (ok.length) onFiles(ok)
  }

  return (
    <div
      className={`wb-drop${over ? ' wb-drop--over' : ''}`}
      onDragEnter={(e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        depth.current += 1
        setOver(true)
      }}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(e) => {
        if (disabled) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        take(e.dataTransfer.files)
      }}
      style={{
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: compact ? space.sm : space.xs,
        padding: compact ? `${space.xs}px ${space.sm}px` : `${space.lg}px ${space.md}px`,
        borderRadius: radius.md,
        textAlign: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ ...(compact ? text.sm : text.base), color: color.body }}>{label}</span>
      {hint && !compact && (
        <span id={hintId} style={{ ...text.sm, color: color.muted }}>
          {hint}
        </span>
      )}
      <Button size="sm" variant="secondary" disabled={disabled} aria-describedby={hint && !compact ? hintId : undefined} onClick={() => input.current?.click()}>
        {buttonLabel}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        tabIndex={-1}
        onChange={(e) => {
          take(e.target.files)
          // The same file chosen twice in a row should still fire a change.
          e.target.value = ''
        }}
      />
    </div>
  )
}

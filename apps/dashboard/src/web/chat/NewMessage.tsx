/**
 * New message: pick someone on the team and open the direct message with
 * them, the phone's compose sheet (ComposeSheet) at a desk.
 *
 * Picking opens the conversation you already have with that person, or
 * starts one exactly as the phone does (data/chat.ts startDm). Only people
 * still on the team are offered; a conversation with someone since taken off
 * stays in the list.
 */
import './chat.css'
import { useMemo, useState } from 'react'
import type { WorkerRow } from '../phone'
import { startDm, type ChatChannel, type ChatPerson } from '../data/chat'
import { color, radius, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Spinner } from '../ui/Button'
import { Drawer } from '../ui/Drawer'
import { Field } from '../ui/Field'
import { PersonCircle } from './bits'

export interface NewMessageProps {
  open: boolean
  me: WorkerRow
  people: Map<string, ChatPerson>
  /** The direct message already open with each person, by their id. */
  dmWith: Map<string, ChatChannel>
  onClose: () => void
  /** Opened or started: `created` when it is new. */
  onOpened: (channel: ChatChannel, created: boolean) => void
}

export function NewMessage({ open, me, people, dmWith, onClose, onOpened }: NewMessageProps) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const crew = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return [...people.values()]
      .filter((p) => p.id !== me.id && p.active !== false)
      .filter((p) => words.every((w) => `${p.name} ${p.trade ?? ''}`.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [people, me.id, q])

  const close = () => {
    if (busy) return
    setQ('')
    setError(null)
    onClose()
  }

  async function pick(p: ChatPerson) {
    if (busy) return
    setBusy(p.id)
    setError(null)
    const out = await startDm({ me, personId: p.id, known: dmWith.get(p.id) ?? null })
    setBusy(null)
    if (!out.ok) {
      setError(out.message)
      return
    }
    setQ('')
    onOpened(out.channel, out.created)
  }

  return (
    <Drawer open={open} title="New message" subtitle="A conversation between the two of you, here and in the app." onClose={close} width={440}>
      <div data-new-message="" style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
        {error && (
          <Banner tone="error" title="Could not open the conversation">
            {error}
          </Banner>
        )}
        <Field label="Find someone" hideLabel placeholder="Search by name or trade" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {crew.length === 0 ? (
          <div style={{ ...text.sm, color: color.muted }}>{q.trim() ? 'Nobody on the team by that name.' : 'Nobody else is on the team yet. Add people on the Team page.'}</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {crew.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="wb-chat-row wb-chat-row--button"
                  data-person={p.id}
                  disabled={busy !== null}
                  onClick={() => void pick(p)}
                  style={{ padding: '8px 10px', borderRadius: radius.md, boxSizing: 'border-box', opacity: busy && busy !== p.id ? 0.6 : 1 }}
                >
                  <PersonCircle id={p.id} initials={p.initials} size={36} />
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <span style={{ ...text.base, fontWeight: 600, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    {p.trade && <span style={{ ...text.xs, color: color.muted }}>{p.trade}</span>}
                  </span>
                  <span style={{ flex: 'none', ...text.xs, color: color.muted }}>{busy === p.id ? <Spinner /> : dmWith.has(p.id) ? 'Open' : 'Start'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  )
}

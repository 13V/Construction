/**
 * One conversation: its messages and the box to answer in. The Chat page
 * shows it beside the list; a job's Chat tab shows it for the job's channel.
 *
 * Drawn the way the phone's thread draws it (ChatScreen): the date in a chip
 * wherever the day changes, a system line down the middle, my messages
 * charcoal on the right, everyone else's white on the left with the time
 * under each. In a job's thread each run of one person's messages carries
 * their name; a direct message is the two of you, so it needs none.
 *
 * Enter sends, Shift+Enter starts a new line (Cmd or Ctrl+Enter sends too).
 * What was typed and not sent is kept per conversation while the website is
 * open. A job's thread takes a photo or a PDF, which goes where the phone's
 * camera key puts a photo; a direct message takes words only, because the
 * phone's direct-message thread shows nothing else.
 *
 * Reading a thread writes nothing (data/chat.ts says why): a conversation
 * stops needing a reply when it is answered.
 */
import './chat.css'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BUCKET_FILES, signedUrl, viewFile, type WorkerRow } from '../phone'
import { attachmentName, CHAT_ACCEPT_DESK, isChatImage, threadItems, type ChatChannel, type ChatPerson, type ThreadMessage } from '../data/chat'
import { color, radius, space, text } from '../tokens'
import { Button, IconButton, Spinner } from '../ui/Button'
import { BubbleIcon, CameraIcon, FileIcon, SendIcon } from './bits'
import { useBoxWidth } from './layout'
import { useThread } from './useThread'

/** Narrower than this, Send is its arrow alone, so the box keeps room for a line. */
const COMPACT_BELOW = 480

/** What was typed and not sent, per conversation, for as long as the website is open. */
const drafts = new Map<string, string>()

/** The box starts one line high and grows to this before it scrolls. */
const BOX_MIN = 42
const BOX_MAX = 168

export interface ChatThreadProps {
  me: WorkerRow
  channel: ChatChannel
  /** Everyone's names, by id (crew_v). */
  people: Map<string, ChatPerson>
  /** Name each run of messages: a job's thread. A direct message is the two of you. */
  showNames: boolean
  /** What the box says before anything is typed. */
  placeholder: string
  /** What a thread with no messages says. */
  empty: ReactNode
  /** What the thread is, for a screen reader: "Messages in Lot 42". */
  label: string
  /** Put the cursor in the box on opening: at a desk, not in a phone-width window. */
  autoFocus?: boolean
  /** Instead of the box, why nothing can be sent here (an archived job). */
  closed?: ReactNode
  /** After a message is sent, with the row as stored. */
  onSent?: (row: ThreadMessage) => void
}

export function ChatThread({ me, channel, people, showNames, placeholder, empty, label, autoFocus = false, closed, onSent }: ChatThreadProps) {
  const thread = useThread(me, channel)
  const [draft, setDraftState] = useState(() => drafts.get(channel.id) ?? '')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const boxId = useId()
  const hintId = useId()
  /** Whether the newest message is in view; new ones only pull the view down when it is. */
  const atBottom = useRef(true)
  /** The message at the top when Show earlier was pressed, and how far down it sat: kept there as the page goes in above it. */
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const canAttach = channel.kind === 'site'
  const [root, width] = useBoxWidth<HTMLDivElement>()
  const compact = width !== null && width < COMPACT_BELOW

  const setDraft = (v: string) => {
    setDraftState(v)
    if (v) drafts.set(channel.id, v)
    else drafts.delete(channel.id)
  }

  const fit = () => {
    const el = box.current
    if (!el) return
    // Empty, it is one line: a placeholder that wraps must not make it taller.
    if (!el.value) {
      el.style.height = `${BOX_MIN}px`
      return
    }
    el.style.height = 'auto'
    el.style.height = `${Math.max(BOX_MIN, Math.min(BOX_MAX, el.scrollHeight + 2))}px`
  }

  // A draft brought back is as tall as it needs to be, and stays so when the
  // box changes width (Send turning into its arrow alone).
  useLayoutEffect(fit, [compact])

  // At a desk the cursor goes in the box, once, on opening: decided on the
  // first render, so a later change (the window narrowing) never moves it. A
  // beat later rather than at once: a thread opened from New message opens as
  // the drawer closes, and a closing drawer puts focus back on whatever
  // opened it.
  const focusOnOpen = useRef(autoFocus && !closed)
  useEffect(() => {
    if (!focusOnOpen.current) return
    const t = window.setTimeout(() => box.current?.focus({ preventScroll: true }), 60)
    return () => window.clearTimeout(t)
  }, [])

  useLayoutEffect(() => {
    const el = log.current
    if (!el) return
    const a = anchor.current
    if (a) {
      const node = el.querySelector<HTMLElement>(`[data-message="${CSS.escape(a.id)}"]`)
      const first = el.querySelector<HTMLElement>('[data-message]')
      if (node && first !== node) {
        // The earlier page is in above it: put it back where it was.
        el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - a.top
        anchor.current = null
        return
      }
      // Nothing earlier came back: stop waiting for it.
      if (!thread.earlierBusy) anchor.current = null
    }
    if (atBottom.current) el.scrollTop = el.scrollHeight
  }, [thread.messages, thread.loaded, thread.earlierBusy])

  const items = useMemo(() => threadItems(thread.messages, me.id), [thread.messages, me.id])

  const busy = sending || uploading

  async function submit() {
    if (busy || closed || !draft.trim()) return
    setSending(true)
    setSendError(null)
    const out = await thread.send(draft)
    setSending(false)
    if (!out.ok) {
      setSendError(out.message)
      return
    }
    atBottom.current = true
    setDraft('')
    requestAnimationFrame(fit)
    onSent?.(out.row)
    box.current?.focus({ preventScroll: true })
  }

  async function sendFile(file: File) {
    if (busy || closed) return
    setUploading(true)
    setSendError(null)
    const out = await thread.attach(file, draft)
    setUploading(false)
    if (!out.ok) {
      setSendError(out.message)
      return
    }
    atBottom.current = true
    setDraft('')
    requestAnimationFrame(fit)
    onSent?.(out.row)
  }

  function earlier() {
    const el = log.current
    const first = el?.querySelector<HTMLElement>('[data-message]')
    if (el && first?.dataset.message) anchor.current = { id: first.dataset.message, top: first.getBoundingClientRect().top - el.getBoundingClientRect().top }
    void thread.readEarlier()
  }

  const nameOf = (m: ThreadMessage) => (m.author_id ? people.get(m.author_id)?.name ?? m.workers?.name ?? 'Crew' : 'Crew')

  return (
    <div ref={root} data-chat-thread={channel.id} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: color.appBg }}>
      <div
        ref={log}
        role="log"
        aria-label={label}
        aria-live="polite"
        tabIndex={0}
        className="wb-focus"
        onScroll={(e) => {
          const el = e.currentTarget
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
        }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', padding: `${space.sm}px clamp(12px, 3vw, ${space.lg}px) ${space.md}px` }}
      >
        {thread.more && (
          <div style={{ alignSelf: 'center', paddingTop: space.xs }}>
            <Button size="sm" variant="ghost" loading={thread.earlierBusy} onClick={earlier} data-chat-earlier="">
              Show earlier messages
            </Button>
          </div>
        )}
        {thread.error && (
          <div role="alert" style={{ alignSelf: 'stretch', display: 'flex', alignItems: 'center', gap: space.sm, margin: `${space.xs}px 0`, padding: '8px 12px', borderRadius: radius.md, background: color.redFill, ...text.sm, color: color.red }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              {thread.messages.length ? 'Could not check for new messages: ' : 'Could not load the messages: '}
              {thread.error}
            </span>
            <Button size="sm" onClick={() => void thread.reload()}>
              Try again
            </Button>
          </div>
        )}
        {!thread.loaded && <div style={{ margin: 'auto', ...text.sm, color: color.faint }}>Loading…</div>}
        {thread.loaded && thread.messages.length === 0 && !thread.error && (
          <div data-chat-empty="" style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: space.xs, maxWidth: 360, padding: space.lg, textAlign: 'center', color: color.ghost }}>
            <BubbleIcon />
            <span style={{ ...text.base, color: color.muted }}>{empty}</span>
          </div>
        )}
        {items.map((it) => {
          if (it.type === 'day') {
            return (
              <div key={it.key} role="separator" aria-label={it.label} style={{ alignSelf: 'center', display: 'inline-flex', alignItems: 'center', height: 24, margin: `${space.md}px 0 ${space.xxs}px`, padding: '0 11px', borderRadius: 12, background: color.pressed, fontSize: 12, fontWeight: 600, color: color.onDarkFaint }}>
                {it.label}
              </div>
            )
          }
          if (it.type === 'system') {
            return (
              <div key={it.key} style={{ alignSelf: 'center', maxWidth: 520, margin: `${space.sm}px 0 0`, padding: '0 14px', textAlign: 'center', ...text.xs, color: color.faint }}>
                {it.message.body} · {it.time}
              </div>
            )
          }
          const m = it.message
          const onlyFile = !!m.attachment_path && !m.body
          const who = it.mine ? 'You' : nameOf(m)
          return (
            <div
              key={it.key}
              data-message={m.id}
              style={{ display: 'flex', flexDirection: 'column', alignItems: it.mine ? 'flex-end' : 'flex-start', alignSelf: it.mine ? 'flex-end' : 'flex-start', maxWidth: 'min(78%, 560px)', marginTop: it.runStart ? 14 : 6 }}
            >
              {showNames && !it.mine && it.runStart ? (
                <span data-sender="" style={{ ...text.xs, fontWeight: 600, color: color.muted, padding: '0 3px 4px' }}>
                  {who}
                </span>
              ) : (
                <span className="wb-sr-only">{who}: </span>
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                  padding: onlyFile ? 4 : '9px 12px',
                  borderRadius: it.mine ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  background: it.mine ? color.charcoal : color.panel,
                  border: `1px solid ${it.mine ? color.charcoal : color.border}`,
                  color: it.mine ? color.onDark : color.ink,
                  ...text.base,
                  overflowWrap: 'anywhere',
                }}
              >
                {m.attachment_path && <Attachment path={m.attachment_path} mine={it.mine} />}
                {m.body && <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>}
              </div>
              <span style={{ ...text.xs, color: color.faint, padding: '3px 3px 0' }}>{it.time}</span>
            </div>
          )
        })}
      </div>

      {closed ? (
        <div data-chat-closed="" style={{ flex: 'none', padding: `${space.sm}px ${space.md}px`, borderTop: `1px solid ${color.borderSoft}`, background: color.panel, ...text.sm, color: color.muted }}>
          {closed}
        </div>
      ) : (
        <div style={{ flex: 'none', padding: `${space.sm}px clamp(12px, 2.4vw, ${space.md}px) ${space.xs}px`, borderTop: `1px solid ${color.borderSoft}`, background: color.panel }}>
          {sendError && (
            <div role="alert" data-chat-send-error="" style={{ display: 'flex', alignItems: 'flex-start', gap: space.xs, marginBottom: space.xs, padding: '8px 12px', borderRadius: radius.md, background: color.redFill, ...text.sm, color: color.red }}>
              <span style={{ flex: 1, minWidth: 0 }}>Not sent. {sendError}</span>
              <button type="button" className="wb-link wb-link--button" onClick={() => setSendError(null)} style={{ ...text.sm, color: color.red }}>
                Dismiss
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            style={{ display: 'flex', alignItems: 'flex-end', gap: space.xs }}
          >
            {canAttach && (
              <>
                <IconButton
                  label="Send a photo or a PDF"
                  size={BOX_MIN}
                  disabled={busy}
                  onClick={() => picker.current?.click()}
                  style={{ border: `1px solid ${color.border}`, borderRadius: radius.md, color: color.body }}
                >
                  {uploading ? <Spinner size={16} /> : <CameraIcon />}
                </IconButton>
                <input
                  ref={picker}
                  type="file"
                  accept={CHAT_ACCEPT_DESK}
                  data-chat-file=""
                  tabIndex={-1}
                  aria-hidden="true"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void sendFile(f)
                  }}
                />
              </>
            )}
            <label htmlFor={boxId} className="wb-sr-only">
              Message
            </label>
            <textarea
              ref={box}
              id={boxId}
              data-chat-input=""
              className="wb-input wb-input--multi"
              rows={1}
              value={draft}
              readOnly={busy}
              placeholder={placeholder}
              aria-describedby={hintId}
              onChange={(e) => {
                setDraft(e.target.value)
                fit()
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                // Shift+Enter is a new line (the textarea's own); Enter, and Cmd or Ctrl+Enter, send.
                if (e.shiftKey || e.altKey) return
                e.preventDefault()
                void submit()
              }}
              style={{ flex: 1, minWidth: 0, height: BOX_MIN, minHeight: BOX_MIN, maxHeight: BOX_MAX, resize: 'none', overflowY: 'auto' }}
            />
            <Button
              type="submit"
              variant="primary"
              data-chat-send=""
              aria-label={compact ? 'Send' : undefined}
              loading={sending}
              disabled={!draft.trim() || uploading}
              icon={<SendIcon />}
              style={compact ? { height: BOX_MIN, width: BOX_MIN, padding: 0 } : { height: BOX_MIN }}
            >
              {compact ? null : 'Send'}
            </Button>
          </form>
          <div id={hintId} style={{ ...text.xs, color: color.faint, padding: '6px 2px 2px' }}>
            Enter sends. Shift+Enter starts a new line.
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A photo or a file in a thread. The bucket is private, so the stored path
 * is traded for a signed link, as the phone's ChatAttachment does; a photo
 * holds its space with a hatch until it arrives. Either opens in the file
 * viewer.
 */
function Attachment({ path, mine }: { path: string; mine: boolean }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void signedUrl(BUCKET_FILES, path).then((u) => {
      if (live) setUrl(u)
    })
    return () => {
      live = false
    }
  }, [path])
  const name = attachmentName(path)
  const open = () => {
    if (url) viewFile({ url, name })
  }

  if (!isChatImage(path)) {
    return (
      <button
        type="button"
        className="wb-chat-photo"
        data-chat-attachment="file"
        onClick={open}
        disabled={!url}
        title={url === null ? 'This file could not be loaded.' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%', padding: '9px 12px', borderRadius: 9, background: mine ? 'rgba(255,255,255,.10)' : color.fill, color: mine ? color.onDark : color.ink, ...text.sm, fontWeight: 600, cursor: url ? 'pointer' : 'default', textAlign: 'left' }}
      >
        <FileIcon />
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className="wb-chat-photo"
      data-chat-attachment="photo"
      aria-label={`Open the photo ${name}`}
      onClick={open}
      disabled={!url}
      style={{
        width: 'min(240px, 100%)',
        aspectRatio: '4 / 3',
        borderRadius: 9,
        overflow: 'hidden',
        background: `repeating-linear-gradient(135deg, ${color.fill} 0 7px, ${color.borderSoft} 7px 14px)`,
        cursor: url ? 'zoom-in' : 'default',
      }}
    >
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      {url === null && <span style={{ display: 'block', padding: 12, ...text.xs, color: color.muted }}>The photo could not be loaded.</span>}
      {url === undefined && (
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: color.ghost }}>
          <Spinner size={16} />
        </span>
      )}
    </button>
  )
}

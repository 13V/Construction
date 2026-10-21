/**
 * The Chat page's list of conversations, as the phone's Chat tab lists them
 * (SimpleChat): what needs a reply on a charcoal card at the top, with how
 * many messages are waiting in each, then every other conversation, newest
 * first. A job's chat wears the job's tile; a direct message the person's
 * circle.
 *
 * Each row is a link to /chat?c=<channel>, so a conversation has its own
 * address and opens in a new tab with a middle click.
 */
import './chat.css'
import type { ReactNode } from 'react'
import type { ChatPerson, ChatSite, ChatSummary } from '../data/chat'
import { linkProps } from '../router'
import { color, radius, space, text } from '../tokens'
import { Button } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { ComposeIcon, JobTile, PersonCircle } from './bits'
import { chatHref } from './layout'

/** On the charcoal card: the phone's own greys for its NEEDS A REPLY rows. */
const ON_CARD = { time: '#98A0A8', preview: '#B4BBC2' }

/** A row's chip (Archived, Off the team): outlined on white, a light wash on the charcoal card. */
const chipOn = (dark: boolean) => (dark ? { bg: 'rgba(255,255,255,.12)', fg: color.onDark } : { tone: 'outline' as const })

export interface ConversationListProps {
  needsReply: ChatSummary<ChatSite>[]
  upToDate: ChatSummary<ChatSite>[]
  /** The conversation open beside the list. */
  openId: string | null
  people: Map<string, ChatPerson>
  loaded: boolean
  onNew: () => void
}

export function ConversationList({ needsReply, upToDate, openId, people, loaded, onNew }: ConversationListProps) {
  const waitingTotal = needsReply.reduce((n, c) => n + c.waiting, 0)
  const nothing = loaded && needsReply.length === 0 && upToDate.length === 0

  return (
    <nav aria-label="Conversations" data-chat-list="" style={{ minHeight: 0, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', background: color.panel }}>
      {!loaded && <div style={{ padding: space.lg, ...text.sm, color: color.faint }}>Loading…</div>}

      {needsReply.length > 0 && (
        <section aria-labelledby="wb-chat-waiting" style={{ padding: `${space.sm}px ${space.sm}px 0` }}>
          <div data-chat-needs-reply="" style={{ display: 'flex', flexDirection: 'column', borderRadius: radius.lg, overflow: 'hidden', background: `linear-gradient(${color.charcoal}, ${color.inkDeep})`, boxShadow: '0 8px 20px rgba(16,20,24,.16), 0 1px 0 rgba(255,255,255,.06) inset' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.xs, padding: '12px 14px 10px' }}>
              <h2 id="wb-chat-waiting" style={{ margin: 0, ...text.label, fontSize: 11.5, letterSpacing: '.14em', color: color.onDarkMuted }}>
                Needs a reply
              </h2>
              <span style={{ ...text.xs, fontWeight: 600, color: ON_CARD.time }}>
                {waitingTotal} message{waitingTotal === 1 ? '' : 's'}
              </span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {needsReply.map((c) => (
                <Row key={c.id} c={c} open={c.id === openId} dark people={people} />
              ))}
            </ul>
          </div>
        </section>
      )}

      {(upToDate.length > 0 || (loaded && needsReply.length > 0)) && (
        <section aria-labelledby="wb-chat-all" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.xs, padding: `${space.md}px 14px ${space.xs}px` }}>
            <h2 id="wb-chat-all" style={{ margin: 0, ...text.label, color: color.muted }}>
              All conversations
            </h2>
            <span style={{ ...text.xs, color: color.muted }}>{upToDate.length} up to date</span>
          </div>
          <ul data-chat-up-to-date="" style={{ margin: 0, padding: 0, listStyle: 'none', borderTop: `1px solid ${color.borderSoft}` }}>
            {upToDate.map((c) => (
              <Row key={c.id} c={c} open={c.id === openId} people={people} />
            ))}
          </ul>
        </section>
      )}

      {nothing && (
        <div data-chat-none="" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space.sm, padding: space.lg }}>
          <div style={{ ...text.base, fontWeight: 600, color: color.ink }}>No conversations yet</div>
          <div style={{ ...text.sm, color: color.body }}>Every job gets its own chat when it is made. New message starts one with someone on the team.</div>
          <Button size="sm" icon={<ComposeIcon size={14} />} onClick={onNew}>
            New message
          </Button>
        </div>
      )}

      {loaded && !nothing && (
        <p style={{ margin: 0, marginTop: 'auto', padding: `${space.md}px 14px`, ...text.xs, color: color.muted }}>
          A conversation needs a reply while someone else has the last word. It clears when you answer, here or in the app.
        </p>
      )}
    </nav>
  )
}

function Row({ c, open, dark = false, people }: { c: ChatSummary<ChatSite>; open: boolean; dark?: boolean; people: Map<string, ChatPerson> }) {
  let avatar: ReactNode
  let flag: ReactNode = null
  if (c.kind === 'site') {
    avatar = <JobTile site={c.site} size={40} />
    if (c.site.status === 'archived') flag = <Chip size="sm" {...chipOn(dark)}>Archived</Chip>
  } else {
    const p = people.get(c.personId)
    avatar = <PersonCircle id={c.personId} initials={p?.initials ?? '??'} size={40} />
    if (p && p.active === false) flag = <Chip size="sm" {...chipOn(dark)}>Off the team</Chip>
  }
  return (
    <li style={{ borderTop: dark ? '1px solid rgba(255,255,255,.08)' : undefined, borderBottom: dark ? undefined : `1px solid ${color.borderSoft}` }}>
      <a
        {...linkProps(chatHref(c.id))}
        className={`wb-chat-row${dark ? ' wb-chat-row--dark' : ''}`}
        aria-current={open ? 'page' : undefined}
        data-conversation={c.id}
        data-waiting={c.waiting}
        style={{ minHeight: 66, padding: '10px 14px', boxSizing: 'border-box' }}
      >
        {avatar}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: space.xs, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, ...text.base, fontWeight: 600, color: dark ? color.onDark : color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
            {flag}
            <span style={{ flex: 'none', ...text.xs, fontWeight: dark ? 600 : 400, color: dark ? ON_CARD.time : color.faint }}>{c.time}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: space.xs, minWidth: 0 }}>
            <span style={{ flex: 1, minWidth: 0, ...text.sm, color: dark ? ON_CARD.preview : color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</span>
            {c.waiting > 0 && (
              <span
                aria-label={`${c.waiting} waiting`}
                style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 10, background: color.accent, boxShadow: '0 0 0 1px rgba(255,255,255,.16)', color: color.onDark, fontSize: 11.5, fontWeight: 700 }}
              >
                {c.waiting}
              </span>
            )}
          </span>
        </span>
      </a>
    </li>
  )
}

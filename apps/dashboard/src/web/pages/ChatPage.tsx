/**
 * Chat, /chat: every job's chat and your direct messages, the phone's Chat
 * tab at a desk, with the open conversation beside the list.
 *
 * The list is the phone's (data/chat.ts summarise, pinned to SimpleChat):
 * what needs a reply first, then everything else, newest first. The open
 * conversation is in the address (/chat?c=<channel>), so it survives a
 * reload and Back walks back through what was open. In a window too narrow
 * for both, the list and the conversation take turns.
 *
 * "Needs a reply" is the phone's own rule: someone else has the last word.
 * Opening a conversation writes nothing, on the phone or here; answering it
 * is what clears it, and the rail's count with it.
 *
 * New message opens, or starts, a direct message with someone on the team,
 * exactly as the phone's compose sheet does. Messages arrive live (realtime,
 * as on the phone), and the page reads again whenever the window comes back.
 */
import '../chat/chat.css'
import { useCallback, useMemo, useState } from 'react'
import { addressLine, builderOf } from '../phone'
import { byChannel, dmByPerson, otherIdOf, summarise, waitingOf, type ChatChannel, type ChatSite } from '../data/chat'
import type { PageProps } from '../routes'
import { navigate, paths, useSearch } from '../router'
import { Page } from '../shell/PageHeader'
import { color, radius, shadow, space, text } from '../tokens'
import { Banner } from '../ui/Banner'
import { Button, IconButton } from '../ui/Button'
import { Chip } from '../ui/Chip'
import { BackIcon, BubbleIcon, ComposeIcon, JobTile, PersonCircle } from '../chat/bits'
import { ConversationList } from '../chat/ConversationList'
import { chatHref, useBoxWidth, useFillHeight } from '../chat/layout'
import { NewMessage } from '../chat/NewMessage'
import { ChatThread } from '../chat/Thread'
import { useInbox } from '../chat/useInbox'

/** Narrower than this, the list and the conversation take turns. */
const TWO_PANE_MIN = 720

export default function ChatPage({ me }: PageProps) {
  const search = useSearch()
  const openId = useMemo(() => new URLSearchParams(search).get('c'), [search])
  const inbox = useInbox(me)
  const { addChannel, noteSent, reload } = inbox
  const [composing, setComposing] = useState(false)
  const [widthBox, width] = useBoxWidth<HTMLDivElement>()
  const [heightBox, height] = useFillHeight<HTMLDivElement>(460, space.xxl)
  const twoPane = width === null || width >= TWO_PANE_MIN
  const listWidth = width === null ? 340 : Math.round(Math.min(340, Math.max(272, width * 0.36)))

  const perChannel = useMemo(() => byChannel(inbox.channels, inbox.messages), [inbox.channels, inbox.messages])
  const waiting = useMemo(() => waitingOf(perChannel, me.id), [perChannel, me.id])

  // The phone lists the chats of jobs that are not archived. An archived
  // job's chat is listed here too while it needs a reply: the rail counts it
  // (the phone's tab bar does too), and a count with nothing to show for it
  // could never be cleared.
  const listedSites = useMemo(() => {
    const m = new Map<string, ChatSite>()
    for (const x of inbox.sites.values()) if (x.status !== 'archived') m.set(x.id, x)
    for (const c of inbox.channels) {
      if (c.kind !== 'site' || !c.site_id || (waiting.get(c.id) ?? 0) === 0) continue
      const x = inbox.sites.get(c.site_id)
      if (x) m.set(x.id, x)
    }
    return m
  }, [inbox.sites, inbox.channels, waiting])

  const { needsReply, upToDate } = useMemo(
    () => summarise({ channels: inbox.channels, perChannel, waiting, people: inbox.people, siteById: listedSites, meId: me.id }),
    [inbox.channels, perChannel, waiting, inbox.people, listedSites, me.id],
  )

  const dmWith = useMemo(() => {
    const byId = new Map(inbox.channels.map((c) => [c.id, c]))
    const out = new Map<string, ChatChannel>()
    for (const [person, id] of dmByPerson(inbox.channels, me.id)) {
      const c = byId.get(id)
      if (c) out.set(person, c)
    }
    return out
  }, [inbox.channels, me.id])

  const open = openId ? inbox.channels.find((c) => c.id === openId) ?? null : null

  const onOpened = useCallback(
    (channel: ChatChannel) => {
      addChannel(channel)
      setComposing(false)
      navigate(chatHref(channel.id))
    },
    [addChannel],
  )

  const showList = twoPane || !openId
  const showThread = twoPane || !!openId

  let pane
  if (!openId) {
    pane = (
      <div data-chat-nothing="" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: space.xs, padding: space.xl, textAlign: 'center', background: color.appBg }}>
        <span style={{ color: color.ghost }}>
          <BubbleIcon size={40} />
        </span>
        <div style={{ ...text.md, fontWeight: 600, color: color.ink }}>Pick a conversation</div>
        <div style={{ maxWidth: 380, ...text.base, color: color.body }}>Each job has its own chat, the same one the crew have in the app. To message one person, start a new message.</div>
        <div style={{ marginTop: space.xs }}>
          <Button icon={<ComposeIcon size={14} />} onClick={() => setComposing(true)}>
            New message
          </Button>
        </div>
      </div>
    )
  } else if (!open) {
    pane = (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: space.xs, padding: space.xl, textAlign: 'center', background: color.appBg }}>
        {!inbox.loaded ? (
          <div style={{ ...text.sm, color: color.faint }}>Loading…</div>
        ) : (
          <>
            <div style={{ ...text.md, fontWeight: 600, color: color.ink }}>This conversation is not here</div>
            <div style={{ maxWidth: 380, ...text.base, color: color.body }}>It may be between two other people, or it was deleted with its job.</div>
            <div style={{ marginTop: space.xs }}>
              <Button href={paths.chat}>All conversations</Button>
            </div>
          </>
        )}
      </div>
    )
  } else {
    const site = open.kind === 'site' && open.site_id ? inbox.sites.get(open.site_id) ?? null : null
    const personId = open.kind === 'dm' ? otherIdOf(open.name, me.id) : null
    const person = personId ? inbox.people.get(personId) ?? null : null
    const title = open.kind === 'site' ? site?.name ?? 'A job' : person?.name ?? 'Crew'
    const first = title.split(' ')[0] || title
    const archived = site?.status === 'archived'
    const sub = site ? [addressLine(site), builderOf(site)].filter(Boolean).join(' · ') : person?.trade ?? ''
    pane = (
      <>
        <div data-chat-head="" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: space.sm, minHeight: 64, padding: `${space.xs}px ${space.md}px`, boxSizing: 'border-box', borderBottom: `1px solid ${color.borderSoft}`, background: color.panel }}>
          {!twoPane && (
            <IconButton label="All conversations" onClick={() => navigate(paths.chat)} style={{ marginLeft: -6 }}>
              <BackIcon />
            </IconButton>
          )}
          {open.kind === 'site' ? (
            <JobTile site={site ?? { id: open.site_id ?? open.id, name: title }} size={36} />
          ) : (
            <PersonCircle id={personId ?? open.id} initials={person?.initials ?? '??'} size={36} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, minWidth: 0 }}>
              <h2 style={{ margin: 0, ...text.md, fontWeight: 600, color: color.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
              {archived && <Chip size="sm" tone="outline">Archived</Chip>}
              {person?.active === false && <Chip size="sm" tone="outline">Off the team</Chip>}
            </div>
            <div style={{ ...text.sm, color: color.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {open.kind === 'site' ? sub || 'Everyone on this job' : sub || 'A direct message'}
            </div>
          </div>
          {site && (
            <Button size="sm" href={paths.job(site.id)}>
              Open job
            </Button>
          )}
        </div>
        <ChatThread
          key={open.id}
          me={me}
          channel={open}
          people={inbox.people}
          showNames={open.kind === 'site'}
          label={open.kind === 'site' ? `Messages in ${title}` : `Messages with ${title}`}
          placeholder={open.kind === 'site' ? 'Message the crew on this job' : `Message ${first}`}
          empty={open.kind === 'site' ? 'No messages yet. Say hello: everyone on this job sees it in the app.' : `You haven't messaged ${first} yet. Say hello.`}
          autoFocus={twoPane}
          closed={archived ? 'This job is archived, so the crew no longer see its chat. Restore the job on its page to message them here again.' : undefined}
          onSent={noteSent}
        />
      </>
    )
  }

  return (
    <Page
      title="Chat"
      subtitle="Every job's chat and your direct messages. The crew see the same in the app."
      actions={
        <Button variant="primary" icon={<ComposeIcon size={14} />} onClick={() => setComposing(true)} data-new-message-open="">
          New message
        </Button>
      }
    >
      {inbox.error && (
        <div style={{ marginBottom: space.md }}>
          <Banner
            tone={inbox.channels.length ? 'warn' : 'error'}
            title={inbox.channels.length ? 'Showing chat as last loaded' : 'Could not load chat'}
            action={
              <Button size="sm" onClick={() => void reload()}>
                Try again
              </Button>
            }
          >
            {inbox.error}
          </Banner>
        </div>
      )}

      <div ref={widthBox} style={{ minWidth: 0 }}>
        <div
          ref={heightBox}
          data-chat-page=""
          style={{
            height,
            display: 'grid',
            gridTemplateColumns: showList && showThread ? `${listWidth}px minmax(0, 1fr)` : 'minmax(0, 1fr)',
            gridTemplateRows: 'minmax(0, 1fr)',
            background: color.panel,
            border: `1px solid ${color.borderSoft}`,
            borderRadius: radius.lg,
            boxShadow: shadow.card,
            overflow: 'hidden',
          }}
        >
          {showList && (
            <div style={{ minHeight: 0, minWidth: 0, borderRight: showThread ? `1px solid ${color.borderSoft}` : undefined }}>
              <ConversationList needsReply={needsReply} upToDate={upToDate} openId={openId} people={inbox.people} loaded={inbox.loaded} onNew={() => setComposing(true)} />
            </div>
          )}
          {showThread && <div style={{ minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{pane}</div>}
        </div>
      </div>

      <NewMessage open={composing} me={me} people={inbox.people} dmWith={dmWith} onClose={() => setComposing(false)} onOpened={onOpened} />
    </Page>
  )
}

/**
 * The job's Chat tab: the job's own channel, the thread the crew see in the
 * app under the job's Chat tab.
 *
 * The channel is found exactly as the phone finds it (ChatScreen: the
 * job's 'site' channel, by its id; data/chat.ts findJobChannel). Nothing
 * here makes one: the database makes a job's channel when the job is made
 * (the job_sites_channel trigger), and the phone never makes one either.
 *
 * The thread is the Chat page's (chat/Thread.tsx): the phone's day chips,
 * names and times, Enter to send, a photo or a PDF where the phone's camera
 * key puts a photo, new messages live and again when the window comes back.
 * An archived job's chat is the record: the crew no longer see the job in
 * the app, so nothing can be sent until it is restored.
 */
import '../../chat/chat.css'
import { useCallback, useEffect, useState } from 'react'
import { findJobChannel, readCrew, type ChatChannel, type ChatPerson } from '../../data/chat'
import { useFresh } from '../../data/useFresh'
import { chatHref, useFillHeight } from '../../chat/layout'
import { announceChat } from '../../chat/live'
import { ChatThread } from '../../chat/Thread'
import { color, radius, shadow, space, text } from '../../tokens'
import { Banner } from '../../ui/Banner'
import { Button } from '../../ui/Button'
import { Empty } from '../../ui/Empty'
import type { JobTabProps } from '../types'

interface Found {
  /** The first look has answered (or failed). */
  looked: boolean
  channel: ChatChannel | null
  error: string | null
}

export default function ChatTab({ me, site }: JobTabProps) {
  const archived = site.status === 'archived'
  const [found, setFound] = useState<Found>({ looked: false, channel: null, error: null })
  const [people, setPeople] = useState<Map<string, ChatPerson>>(new Map())
  const [box, height] = useFillHeight<HTMLDivElement>(420, space.xxl)

  const look = useCallback(async () => {
    try {
      const channel = await findJobChannel(site.id)
      setFound((f) => ({ looked: true, channel: channel ?? f.channel, error: null }))
    } catch (e) {
      setFound((f) => ({ ...f, looked: true, error: e instanceof Error ? e.message : String(e) }))
    }
  }, [site.id])

  const readPeople = useCallback(async () => {
    try {
      const crew = await readCrew()
      setPeople(new Map(crew.map((p) => [p.id, p])))
    } catch {
      // Names fall back to the ones each message brings with it.
    }
  }, [])

  useEffect(() => {
    void look()
    void readPeople()
  }, [look, readPeople])
  // Looked for again when the window comes back while it is missing or the look failed.
  useFresh(() => {
    if (!found.channel || found.error) void look()
    void readPeople()
  })

  const { channel } = found

  return (
    <div data-chat-tab="" style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h2 style={{ margin: 0, ...text.md, fontWeight: 600, color: color.ink }}>Chat</h2>
          <div style={{ ...text.sm, color: color.muted }}>Everyone on this job reads and writes here in the app, under the job's Chat tab.</div>
        </div>
        {channel && (
          <Button href={chatHref(channel.id)} data-chat-open-all="">
            Open in Chat
          </Button>
        )}
      </div>

      {archived && <Banner title="This job is archived">The crew no longer see it in the app, so nothing can be sent here. Restore it from the top of the page to message them again. What is below is the record.</Banner>}
      {found.error && (
        <Banner
          tone={channel ? 'warn' : 'error'}
          title={channel ? 'Could not check the chat again' : "Could not open this job's chat"}
          action={
            <Button size="sm" onClick={() => void look()}>
              Try again
            </Button>
          }
        >
          {found.error}
        </Banner>
      )}

      <div
        ref={box}
        style={{ height, display: 'flex', flexDirection: 'column', background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg, boxShadow: shadow.card, overflow: 'hidden' }}
      >
        {channel ? (
          <ChatThread
            key={channel.id}
            me={me}
            channel={channel}
            people={people}
            showNames
            label={`Messages in ${site.name}`}
            placeholder="Message the crew on this job"
            empty="No messages yet. Say hello: everyone on this job sees it in the app."
            closed={archived ? 'This job is archived. Restore it to message the crew here.' : undefined}
            onSent={(row) => announceChat(row)}
          />
        ) : !found.looked ? (
          <div style={{ margin: 'auto', ...text.sm, color: color.faint }}>Loading…</div>
        ) : (
          !found.error && (
            <Empty
              title="This job has no chat yet"
              data-chat-missing=""
              style={{ margin: 'auto', border: 0 }}
              action={<Button onClick={() => void look()}>Look again</Button>}
            >
              A job's chat is made with the job. Look again in a moment.
            </Empty>
          )
        )}
      </div>
    </div>
  )
}

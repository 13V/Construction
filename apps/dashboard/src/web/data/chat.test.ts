import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import chatSrc from '../../worker/simple/Chat.tsx?raw'
import appSrc from '../../worker/WorkerApp.tsx?raw'
import { avatarGrey, BUCKET_FILES, objectPath, removeFile, uploadFile } from '../phone'
import {
  attachmentName,
  attachmentRefusal,
  byChannel,
  CHANNEL_COLS,
  channelFilter,
  CHAT_ACCEPT,
  CHAT_ATTACHMENT_MAX,
  CHAT_IMAGE_RE,
  clockLabel,
  companyFilter,
  countUnread,
  dayLabel,
  dmByPerson,
  dmChannelInsert,
  dmMemberRows,
  dmMessageInsert,
  dmName,
  findJobChannel,
  INBOX_COLS,
  INBOX_LIMIT,
  isMine,
  jobInit,
  jobMessageInsert,
  mergeThread,
  otherIdOf,
  PAGE_INBOX_COLS,
  personTone,
  previewBody,
  readInbox,
  readThread,
  sendAttachment,
  sendMessage,
  startDm,
  summarise,
  THREAD_COLS,
  THREAD_PAGE,
  threadItems,
  timeLabel,
  UNREAD_COLS,
  unreadCount,
  waitingOf,
  withMessage,
  type ChatChannel,
  type ChatMessage,
  type Db,
} from './chat'

// Storage goes through the phone's own helpers; here they are stand-ins, so
// nothing leaves the test. objectPath is the real one, watched.
vi.mock('../phone', async (importOriginal) => {
  const real = await importOriginal<typeof import('../phone')>()
  return {
    ...real,
    objectPath: vi.fn(real.objectPath),
    uploadFile: vi.fn(async (_bucket: string, path: string) => path),
    removeFile: vi.fn(async () => {}),
  }
})

/**
 * Chat, read from the phone's own source (worker/simple/Chat.tsx and
 * worker/WorkerApp.tsx) and run beside the website's copies in chat.ts: the
 * inbox reads, which channels are yours, what is waiting on you and the tab
 * bar's count, the conversation list, the labels, a job's channel and its
 * thread, the rows a message and a direct message write, and where a photo
 * goes. Change the phone and this names what to bring into line.
 */

const CHAT = ts.createSourceFile('Chat.tsx', chatSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const APP = ts.createSourceFile('WorkerApp.tsx', appSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function all<T extends ts.Node>(root: ts.Node, test: (n: ts.Node) => n is T): T[] {
  const out: T[] = []
  const visit = (n: ts.Node) => {
    if (test(n)) out.push(n)
    ts.forEachChild(n, visit)
  }
  visit(root)
  return out
}

type Decl = ts.FunctionDeclaration | ts.VariableDeclaration
/** The one declaration of `name` inside `root`. */
function decl(root: ts.Node, name: string): Decl {
  const sf = root.getSourceFile()
  const found = all(root, (n): n is Decl => (ts.isFunctionDeclaration(n) && n.name?.text === name) || (ts.isVariableDeclaration(n) && n.name.getText(sf) === name))
  if (found.length !== 1) throw new Error(`${sf.fileName}: expected one declaration of ${name}, found ${found.length}. Was it renamed or moved?`)
  return found[0]!
}

/** A top-level declaration's whole statement, to run. */
const statement = (d: Decl) => (ts.isVariableDeclaration(d) ? d.parent.parent : d).getText(d.getSourceFile())

const js = (tsx: string) =>
  ts.transpileModule(tsx, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText.replace(/^export\s*\{\s*\};?\s*$/m, '')

/** Run `body` with `scope` in it and return the value of `ret`. */
function run<T>(body: string, scope: Record<string, unknown>, ret: string): T {
  const names = Object.keys(scope)
  return new Function(...names, `${js(`${body}\nconst __ret = (${ret})`)}\nreturn __ret`)(...names.map((n) => scope[n])) as T
}

/** Every call of `.method(...)` inside `root`. */
const callsOf = (root: ts.Node, method: string) =>
  all(root, (n): n is ts.CallExpression => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === method)

/** The outermost call of a PostgREST chain that starts with .from(`table`), inside `root`. */
function chainFrom(root: ts.Node, table: string, pick: (c: ChainStep[]) => boolean = () => true): ChainStep[] {
  const sf = root.getSourceFile()
  const chains = callsOf(root, 'from')
    .filter((c) => c.arguments[0]?.getText(sf) === `'${table}'`)
    .map((from) => {
      // Climb to the outermost call of the chain this .from starts.
      let at: ts.Expression = from
      while (ts.isPropertyAccessExpression(at.parent) && ts.isCallExpression(at.parent.parent) && at.parent.parent.expression === at.parent) at = at.parent.parent
      return steps(at as ts.CallExpression)
    })
    .filter(pick)
  if (chains.length !== 1) throw new Error(`${sf.fileName}: expected one .from('${table}') chain here, found ${chains.length}`)
  return chains[0]!
}

interface ChainStep {
  method: string
  /** As written. */
  args: string
}
function steps(call: ts.CallExpression): ChainStep[] {
  const sf = call.getSourceFile()
  const out: ChainStep[] = []
  let at: ts.Expression = call
  while (ts.isCallExpression(at) && ts.isPropertyAccessExpression(at.expression)) {
    out.unshift({ method: at.expression.name.text, args: at.arguments.map((a) => a.getText(sf)).join(', ') })
    at = at.expression.expression
  }
  return out
}

/**
 * A phone chain with its arguments worked out, `scope` standing in for the
 * variables it uses. The .from() is left off, and so is what the phone does
 * with the answer (.then).
 */
const evaluated = (chain: ChainStep[], scope: Record<string, unknown> = {}) =>
  chain.filter((s) => !['from', 'then', 'catch', 'finally'].includes(s.method)).map((s) => [s.method, run<unknown[]>('', scope, `[${s.args}]`)] as const)

/** The arrow function a `const <name> = useMemo(() => …)` memoises, as source. */
function memoOf(root: ts.Node, name: string): string {
  const sf = root.getSourceFile()
  const found = all(root, (n): n is ts.VariableDeclaration => ts.isVariableDeclaration(n) && n.name.getText(sf).replace(/\s+/g, ' ') === name && !!n.initializer && ts.isCallExpression(n.initializer) && n.initializer.expression.getText(sf) === 'useMemo')
  if (found.length !== 1) throw new Error(`${sf.fileName}: expected one useMemo named ${name}, found ${found.length}`)
  return (found[0]!.initializer as ts.CallExpression).arguments[0]!.getText(sf)
}

interface Call {
  table: string
  method: string
  args: unknown[]
}
/** A fake client that records every call and answers each chain with `answer(table, calls)`. */
function recorder(answer: (table: string, calls: Call[]) => unknown) {
  const calls: Call[] = []
  const chainFor = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'lte', 'order', 'limit', 'insert', 'single', 'maybeSingle']) {
      b[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args: JSON.parse(JSON.stringify(args)) as unknown[] })
        return b
      }
    }
    b.then = (resolve: (v: unknown) => void) => resolve(answer(table, calls))
    return b
  }
  return { calls, client: { from: chainFor } as unknown as Db }
}
const callsTo = (calls: Call[], table: string) => calls.filter((c) => c.table === table).map((c) => [c.method, c.args] as const)

// ------------------------------------------------------------------ the phone's pieces

const waitingHook = decl(CHAT, 'useChannelWaiting') as ts.FunctionDeclaration
const unreadHook = decl(CHAT, 'useUnreadCount') as ts.FunctionDeclaration
const simpleChat = decl(CHAT, 'SimpleChat') as ts.FunctionDeclaration
const composeSheet = decl(CHAT, 'ComposeSheet') as ts.FunctionDeclaration
const dmThread = decl(CHAT, 'DmThread') as ts.FunctionDeclaration
const chatScreen = decl(APP, 'ChatScreen') as ts.FunctionDeclaration

const phone = {
  timeLabel: run<(iso: string) => string>(statement(decl(CHAT, 'timeLabel')), {}, 'timeLabel'),
  dayLabel: run<(d: Date) => string>(statement(decl(CHAT, 'dayLabel')), {}, 'dayLabel'),
  chatDayLabel: run<(d: Date) => string>(statement(decl(APP, 'chatDayLabel')), {}, 'chatDayLabel'),
  jobInit: run<(name: string) => string>(statement(decl(CHAT, 'jobInit')), {}, 'jobInit'),
  dmName: run<(a: string, b: string) => string>(statement(decl(CHAT, 'dmName')), {}, 'dmName'),
  otherIdOf: run<(name: string, meId: string) => string | null>(statement(decl(CHAT, 'otherIdOf')), {}, 'otherIdOf'),
  personTone: run<(id: string) => string>(statement(decl(CHAT, 'personTone')), { avatarGrey }, 'personTone'),
}

// ------------------------------------------------------------------ fixtures

const ME = { id: 'w-me', company_id: 'co-1' }
const DEAN = 'w-dean'
const MARIA = 'w-maria'
const ch = (id: string, kind: 'site' | 'dm', name: string, site_id: string | null = null): ChatChannel => ({ id, kind, site_id, name })
const CHANNELS: ChatChannel[] = [
  ch('c-seacombe', 'site', 'Seacombe gardens', 's-seacombe'),
  ch('c-lot42', 'site', 'Lot 42, Kentish Ave', 's-lot42'),
  ch('c-archived', 'site', 'Old job', 's-archived'),
  ch('c-dm-dean', 'dm', dmName(ME.id, DEAN)),
  ch('c-dm-maria', 'dm', dmName(ME.id, MARIA)),
  // Two other people's direct message: readable, but not mine.
  ch('c-dm-others', 'dm', dmName(DEAN, MARIA)),
]
let seq = 0
const msg = (channel_id: string, author_id: string | null, created_at: string, body = `m${++seq}`, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m-${++seq}`,
  channel_id,
  author_id,
  kind: 'user',
  body,
  created_at,
  ...extra,
})
/** Newest first, as the inbox reads them. */
const MESSAGES: ChatMessage[] = [
  msg('c-lot42', DEAN, '2026-10-21T03:10:00.000Z', 'Tiles are on site'),
  msg('c-lot42', MARIA, '2026-10-21T03:05:00.000Z', 'Who has the key?'),
  msg('c-lot42', ME.id, '2026-10-21T02:00:00.000Z', 'Start at 7'),
  msg('c-lot42', DEAN, '2026-10-20T23:00:00.000Z', 'Morning'),
  msg('c-dm-dean', ME.id, '2026-10-20T06:00:00.000Z', 'Thanks Dean'),
  msg('c-dm-dean', DEAN, '2026-10-20T05:00:00.000Z', 'Done for the day'),
  msg('c-dm-maria', MARIA, '2026-10-17T01:00:00.000Z', 'Can I swap Friday?'),
  msg('c-archived', null, '2026-10-01T01:00:00.000Z', 'From someone since deleted'),
  msg('c-dm-others', DEAN, '2026-10-21T04:00:00.000Z', 'Not for the owner'),
  msg('c-gone', DEAN, '2026-10-21T04:30:00.000Z', 'A channel nobody listed'),
]
const PEOPLE = new Map([
  [ME.id, { id: ME.id, name: 'Troy Watson', initials: 'TW', trade: 'Office' }],
  [DEAN, { id: DEAN, name: 'Dean Papadopoulos', initials: 'DP', trade: 'Tiler' }],
  [MARIA, { id: MARIA, name: 'Maria Voulgaris', initials: 'MV', trade: 'Tiler' }],
])
const SITES = [
  { id: 's-seacombe', name: 'Seacombe gardens', colour: null },
  { id: 's-lot42', name: 'Lot 42, Kentish Ave', colour: '#4C7FB8' },
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-21T05:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

// ------------------------------------------------------------------ the inbox

describe("the phone's inbox reads (useChannelWaiting)", () => {
  const promiseAll = callsOf(waitingHook, 'all')
  it('reads channels and messages together, as the phone does', () => {
    expect(promiseAll).toHaveLength(1)
  })

  const channelsChain = chainFrom(waitingHook, 'channels')
  const messagesChain = chainFrom(waitingHook, 'messages')

  it('the same channels: every job and direct message', () => {
    expect(channelsChain.map((s) => s.method)).toEqual(['from', 'select', 'in'])
    expect(run<string>('', {}, channelsChain[1]!.args)).toBe(CHANNEL_COLS)
  })

  it('the same messages: what people wrote, newest first, the same 400', () => {
    expect(run<string>('', {}, messagesChain[1]!.args)).toBe(INBOX_COLS)
    const limit = evaluated(messagesChain).find(([m]) => m === 'limit')![1][0]
    expect(INBOX_LIMIT).toBe(limit)
  })

  for (const [label, cols] of [
    ["the phone's own columns", INBOX_COLS],
    ["the Chat page's", PAGE_INBOX_COLS],
    ["the rail's", UNREAD_COLS],
  ] as const) {
    it(`readInbox with ${label} asks exactly what the phone asks, bar the columns`, async () => {
      const { calls, client } = recorder((table) => ({ data: table === 'channels' ? CHANNELS : MESSAGES, error: null }))
      await readInbox(ME, cols, client)
      const phoneChannels = evaluated(channelsChain)
      const phoneMessages = evaluated(messagesChain)
      expect(callsTo(calls, 'channels')).toEqual(phoneChannels)
      expect(callsTo(calls, 'messages')).toEqual(phoneMessages.map(([m, a]) => (m === 'select' ? [m, [cols]] : [m, a])))
    })
  }

  it("the page's columns are the phone's and the photo; the rail's are what the count needs", () => {
    const split = (s: string) => s.split(',').map((x) => x.trim())
    expect(split(PAGE_INBOX_COLS)).toEqual([...split(INBOX_COLS), 'attachment_path'])
    for (const col of split(UNREAD_COLS)) expect(split(INBOX_COLS)).toContain(col)
    // What byChannel, waitingOf and the live merge read.
    expect(split(UNREAD_COLS)).toEqual(expect.arrayContaining(['id', 'channel_id', 'author_id', 'kind']))
    expect(split(UNREAD_COLS)).not.toContain('body')
  })

  it('keeps the channels that are mine, the same way', () => {
    const filters = all(waitingHook, (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(CHAT) === 'rows.filter')
    expect(filters).toHaveLength(1)
    const phoneMine = run<(c: ChatChannel) => boolean>('', { me: ME }, filters[0]!.arguments[0]!.getText(CHAT))
    const cases = [...CHANNELS, ch('x', 'dm', `dm:${ME.id}`), ch('y', 'dm', 'dm:a:b'), ch('z', 'site', 'Anything at all')]
    for (const c of cases) expect(isMine(c, ME.id)).toBe(phoneMine(c))
    // And the live handler drops a new channel by the same rule.
    expect(waitingHook.getText(CHAT)).toContain("if (row.kind !== 'site' && !row.name.split(':').includes(me.id)) return")
  })

  it('a failed read is an error, not an empty inbox', async () => {
    const { client } = recorder((table) => (table === 'messages' ? { data: null, error: { message: 'JWT expired' } } : { data: CHANNELS, error: null }))
    await expect(readInbox(ME, INBOX_COLS, client)).rejects.toThrow('JWT expired')
  })
})

describe('what is waiting, and the count on the tab bar', () => {
  const perChannelOf = run<(channels: ChatChannel[], messages: ChatMessage[]) => Map<string, ChatMessage[]>>('', {}, `(channels, messages) => (${memoOf(waitingHook, 'perChannel')})()`)
  const waitingFor = run<(perChannel: Map<string, ChatMessage[]>, me: { id: string }) => Map<string, number>>('', {}, `(perChannel, me) => (${memoOf(waitingHook, 'waiting')})()`)
  const memos = all(unreadHook, (n): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText(CHAT) === 'useMemo')
  if (memos.length !== 1) throw new Error(`Chat.tsx: useUnreadCount should memoise one count, found ${memos.length}`)
  const unreadOf = run<(waiting: Map<string, number>) => number>('', {}, `(waiting) => (${memos[0]!.arguments[0]!.getText(CHAT)})()`)

  const mine = CHANNELS.filter((c) => isMine(c, ME.id))
  const cases: Array<[string, ChatMessage[]]> = [
    ['the fixtures', MESSAGES],
    ['nothing at all', []],
    ['only mine', [msg('c-lot42', ME.id, '2026-10-21T01:00:00Z')]],
    ['someone after me, then me again', [msg('c-lot42', ME.id, '2026-10-21T03:00:00Z'), msg('c-lot42', DEAN, '2026-10-21T02:00:00Z'), msg('c-lot42', ME.id, '2026-10-21T01:00:00Z')]],
    ['three in a row since I spoke', [msg('c-dm-dean', DEAN, '3'), msg('c-dm-dean', DEAN, '2'), msg('c-dm-dean', MARIA, '1'), msg('c-dm-dean', ME.id, '0')]],
  ]

  for (const [label, messages] of cases) {
    it(`matches the phone for ${label}`, () => {
      const phonePer = perChannelOf(mine, messages)
      expect(byChannel(mine, messages)).toEqual(phonePer)
      const phoneWaiting = waitingFor(phonePer, ME)
      expect(waitingOf(phonePer, ME.id)).toEqual(phoneWaiting)
      expect(unreadCount(phoneWaiting)).toBe(unreadOf(phoneWaiting))
      expect(countUnread({ channels: mine, messages }, ME.id)).toBe(unreadOf(phoneWaiting))
    })
  }

  it('counts conversations, not messages; ignores channels not mine or not listed', () => {
    const waiting = waitingOf(byChannel(mine, MESSAGES), ME.id)
    expect(Object.fromEntries(waiting)).toEqual({ 'c-lot42': 2, 'c-dm-dean': 0, 'c-dm-maria': 1, 'c-archived': 1 })
    // An archived job's channel still counts on the phone's tab bar, so here too.
    expect(countUnread({ channels: mine, messages: MESSAGES }, ME.id)).toBe(3)
  })

  it('answering clears it; reading writes nothing, so only answering does', () => {
    const answered = withMessage(MESSAGES, msg('c-lot42', ME.id, '2026-10-21T04:59:00Z', 'On my way'))
    expect(countUnread({ channels: mine, messages: answered }, ME.id)).toBe(2)
    // The phone's live handler puts a new message on the front, once.
    expect(withMessage(answered, answered[0]!)).toBe(answered)
  })

  it('subscribes to the same live messages: the inbox by company, a thread by channel', () => {
    const ons = callsOf(waitingHook, 'on').filter((c) => c.arguments[1]?.getText(CHAT).includes("table: 'messages'"))
    expect(ons).toHaveLength(1)
    const inboxSub = run<{ event: string; table: string; filter: string }>('', { me: ME }, ons[0]!.arguments[1]!.getText(CHAT))
    expect(inboxSub).toMatchObject({ event: 'INSERT', schema: 'public', table: 'messages' })
    expect(companyFilter(ME.company_id)).toBe(inboxSub.filter)
    expect(waitingHook.getText(CHAT)).toContain("if (row.kind !== 'user') return")

    const threadOns = callsOf(chatScreen, 'on')
    expect(threadOns).toHaveLength(1)
    const threadSub = run<{ filter: string }>('', { id: 'ch-1' }, threadOns[0]!.arguments[1]!.getText(APP))
    expect(threadSub).toMatchObject({ event: 'INSERT', schema: 'public', table: 'messages' })
    expect(channelFilter('ch-1')).toBe(threadSub.filter)
  })
})

// ------------------------------------------------------------------ the list

describe("the phone's conversation list (SimpleChat)", () => {
  const listMemo = memoOf(simpleChat, '{ unreadList, readList }')
  const phoneList = run<
    (scope: {
      channels: ChatChannel[]
      perChannel: Map<string, ChatMessage[]>
      waiting: Map<string, number>
      people: Map<string, { name: string }>
      siteById: Map<string, { id: string; name: string }>
      me: { id: string }
    }) => { unreadList: unknown[]; readList: unknown[] }
  >('', { timeLabel: phone.timeLabel, otherIdOf: phone.otherIdOf }, `({ channels, perChannel, waiting, people, siteById, me }) => (${listMemo})()`)

  const mine = CHANNELS.filter((c) => isMine(c, ME.id))

  for (const [label, messages, sites, people] of [
    ['the fixtures', MESSAGES, SITES, PEOPLE],
    ['no messages anywhere', [], SITES, PEOPLE],
    ['nobody known by name', MESSAGES, SITES, new Map()],
    ['no jobs loaded', MESSAGES, [], PEOPLE],
  ] as const) {
    it(`makes the same rows, in the same order, for ${label}`, () => {
      const perChannel = byChannel(mine, messages)
      const waiting = waitingOf(perChannel, ME.id)
      const siteById = new Map(sites.map((x) => [x.id, x]))
      const p = phoneList({ channels: mine, perChannel, waiting, people, siteById, me: ME })
      const w = summarise({ channels: mine, perChannel, waiting, people, siteById, meId: ME.id })
      expect(w.needsReply).toEqual(p.unreadList)
      expect(w.upToDate).toEqual(p.readList)
    })
  }

  it('says Photo where a message is only a photo (the phone shows nothing after the name)', () => {
    const photo = msg('c-lot42', DEAN, '2026-10-21T04:00:00Z', '', { attachment_path: 'co-1/c-lot42/0b0c-photo.jpg' })
    const perChannel = byChannel(mine, [photo, ...MESSAGES])
    const w = summarise({ channels: mine, perChannel, waiting: waitingOf(perChannel, ME.id), people: PEOPLE, siteById: new Map(SITES.map((x) => [x.id, x])), meId: ME.id })
    expect(w.needsReply.find((r) => r.id === 'c-lot42')?.preview).toBe('Dean: Photo')
    expect(previewBody({ body: '', attachment_path: 'a/b/c-plan.pdf' })).toBe('File')
    expect(previewBody({ body: 'Look', attachment_path: 'a/b/c.jpg' })).toBe('Look')
  })

  it('finds the person each direct message is with, the same way', () => {
    const phoneDm = run<(channels: ChatChannel[], me: { id: string }) => Map<string, string>>('', { otherIdOf: phone.otherIdOf }, `(channels, me) => (${memoOf(simpleChat, 'dmByPerson')})()`)
    expect(dmByPerson(CHANNELS, ME.id)).toEqual(phoneDm(CHANNELS, ME))
  })
})

// ------------------------------------------------------------------ names and labels

describe("the phone's names and labels", () => {
  const instants = [
    '2026-10-21T04:59:00.000Z', // today, Adelaide or UTC
    '2026-10-21T00:01:00.000Z',
    '2026-10-20T13:30:00.000Z', // around midnight in Adelaide
    '2026-10-20T03:00:00.000Z', // yesterday
    '2026-10-19T23:00:00.000Z',
    '2026-10-16T22:15:00.000Z', // last week
    '2025-12-25T01:00:00.000Z', // last year
  ]

  it('timeLabel', () => {
    for (const iso of instants) expect(timeLabel(iso)).toBe(phone.timeLabel(iso))
  })

  it("dayLabel, the same in the job thread and the DM thread", () => {
    for (const iso of instants) {
      const d = new Date(iso)
      expect(dayLabel(d)).toBe(phone.chatDayLabel(d))
      expect(dayLabel(d)).toBe(phone.dayLabel(d))
    }
  })

  it("a message's time", () => {
    const calls = callsOf(chatScreen, 'toLocaleTimeString')
    expect(calls).toHaveLength(1)
    const args = run<unknown[]>('', {}, `[${calls[0]!.arguments.map((a) => a.getText(APP)).join(', ')}]`)
    for (const iso of instants) expect(clockLabel(iso)).toBe(new Date(iso).toLocaleTimeString(...(args as [string, Intl.DateTimeFormatOptions])))
  })

  it('jobInit, dmName, otherIdOf, personTone', () => {
    for (const name of ['Lot 42, Kentish Ave', 'Hallett Cove', 'Seacombe gardens', 'ZZ-chat-1761040000000', '12', '', '  Lead space']) expect(jobInit(name)).toBe(phone.jobInit(name))
    for (const [a, b] of [['b', 'a'], [ME.id, DEAN], [DEAN, ME.id]]) expect(dmName(a!, b!)).toBe(phone.dmName(a!, b!))
    for (const name of [dmName(ME.id, DEAN), dmName(DEAN, MARIA), `dm:${ME.id}`, 'Seacombe gardens']) expect(otherIdOf(name, ME.id)).toBe(phone.otherIdOf(name, ME.id))
    for (const id of [ME.id, DEAN, MARIA, 'd60b7170-c110-48d7-903e-d395e4330ddf']) expect(personTone(id)).toBe(phone.personTone(id))
  })
})

// ------------------------------------------------------------------ a job's channel and its thread

describe("a job's thread (ChatScreen)", () => {
  it("finds the job's channel the way the phone does, and never makes one", async () => {
    const phoneChain = evaluated(chainFrom(chatScreen, 'channels'), { siteId: 'site-1' })
    const { calls, client } = recorder(() => ({ data: { id: 'ch-1', kind: 'site', site_id: 'site-1', name: 'Job' }, error: null }))
    expect(await findJobChannel('site-1', client)).toMatchObject({ id: 'ch-1' })
    expect(callsTo(calls, 'channels')).toEqual(phoneChain)
    // The phone has no insert into channels for a job: the database's trigger makes it.
    expect(callsOf(chatScreen, 'insert').filter((c) => c.getText(APP).includes("'channels'"))).toHaveLength(0)
  })

  it('reads the newest page the same way, and shows it oldest first', async () => {
    const phoneChain = evaluated(chainFrom(chatScreen, 'messages', (c) => c.some((s) => s.method === 'order')), { channel: { id: 'ch-1' } })
    expect(phoneChain.find(([m]) => m === 'select')![1][0]).toBe(THREAD_COLS)
    expect(phoneChain.find(([m]) => m === 'limit')![1][0]).toBe(THREAD_PAGE)
    expect(chatScreen.getText(APP)).toContain('.slice().reverse()')

    const newest = [msg('ch-1', DEAN, '2026-10-21T03:00:00Z'), msg('ch-1', ME.id, '2026-10-21T02:00:00Z')]
    const { calls, client } = recorder(() => ({ data: newest, error: null }))
    const page = await readThread('ch-1', {}, client)
    expect(callsTo(calls, 'messages')).toEqual(phoneChain)
    expect(page.messages.map((m) => m.id)).toEqual([newest[1]!.id, newest[0]!.id])
    expect(page.more).toBe(false)
  })

  it('an earlier page asks for the 50 written up to the oldest shown, so none that share its moment are skipped', async () => {
    const { calls, client } = recorder(() => ({ data: Array.from({ length: THREAD_PAGE }, (_, i) => msg('ch-1', DEAN, `2026-10-01T00:00:${String(59 - i).padStart(2, '0')}Z`)), error: null }))
    const page = await readThread('ch-1', { upTo: '2026-10-02T00:00:00Z' }, client)
    expect(callsTo(calls, 'messages')).toContainEqual(['lte', ['created_at', '2026-10-02T00:00:00Z']])
    expect(page.more).toBe(true)
    // The one already shown comes back too, and goes in once.
    const shownAlready = page.messages[page.messages.length - 1]!
    expect(mergeThread(page.messages, [shownAlready])).toHaveLength(THREAD_PAGE)
  })

  it("the phone's direct-message thread reads the newest 300, newest first (as a job's thread does, and the website)", () => {
    const dmRead = evaluated(chainFrom(dmThread, 'messages', (c) => c.some((s) => s.method === 'order')), { channelId: 'ch-1' })
    expect(dmRead).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(dmRead).toContainEqual(['limit', [300]])
  })
})

describe('sending', () => {
  const sendIn = (root: ts.FunctionDeclaration) => decl(root, 'send') as ts.FunctionDeclaration
  const insertLiteral = (root: ts.Node) => {
    const inserts = callsOf(root, 'insert').filter((c) => c.arguments[0] && ts.isObjectLiteralExpression(c.arguments[0]))
    expect(inserts).toHaveLength(1)
    return inserts[0]!.arguments[0]!.getText(root.getSourceFile())
  }

  it("a job's thread sends ChatScreen's row: same keys, same values, a photo or none", () => {
    const literal = insertLiteral(sendIn(chatScreen))
    for (const [body, attachmentPath] of [['Morning all', undefined], ['', 'co-1/ch-1/uuid-photo.jpg'], ['Caption', 'co-1/ch-1/uuid-photo.jpg']] as const) {
      const p = run<Record<string, unknown>>('', { me: ME, channel: { id: 'ch-1' }, body, attachmentPath }, literal)
      const w = jobMessageInsert({ me: ME, channelId: 'ch-1', body, attachmentPath })
      expect(Object.keys(w)).toEqual(Object.keys(p))
      expect(w).toEqual(p)
    }
  })

  it("a direct message sends DmThread's row: words only", () => {
    const literal = insertLiteral(sendIn(dmThread))
    const p = run<Record<string, unknown>>('', { me: ME, channelId: 'ch-dm', body: 'Hello' }, literal)
    const w = dmMessageInsert({ me: ME, channelId: 'ch-dm', body: 'Hello' })
    expect(Object.keys(w)).toEqual(Object.keys(p))
    expect(w).toEqual(p)
  })

  it('both trim what was typed, as the phone does, and read the row back', async () => {
    expect(sendIn(chatScreen).getText(APP)).toContain('const body = draft.trim()')
    expect(sendIn(dmThread).getText(CHAT)).toContain('const body = draft.trim()')
    const phoneChain = chainFrom(sendIn(chatScreen), 'messages').map((s) => s.method)

    const { calls, client } = recorder((_t, log) => {
      const sent = log.find((c) => c.method === 'insert')!.args[0] as Record<string, unknown>
      return { data: { id: 'm-new', created_at: '2026-10-21T05:00:00Z', ...sent }, error: null }
    })
    const out = await sendMessage({ me: ME, channel: { id: 'ch-1', kind: 'site' }, draft: '  Line one\nline two  ' }, client)
    expect(out).toMatchObject({ ok: true, row: { id: 'm-new', body: 'Line one\nline two' } })
    expect(['from', ...calls.map((c) => c.method)]).toEqual(phoneChain)
    expect(calls[0]!.args[0]).toEqual(jobMessageInsert({ me: ME, channelId: 'ch-1', body: 'Line one\nline two' }))
  })

  it('a refused write is an error, never a message that only looks sent', async () => {
    const refused = recorder(() => ({ data: null, error: { message: 'new row violates row-level security policy for table "messages"' } }))
    expect(await sendMessage({ me: ME, channel: { id: 'ch-1', kind: 'site' }, draft: 'Hi' }, refused.client)).toEqual({ ok: false, message: expect.stringMatching(/row-level security/) })
    const wrong = recorder(() => ({ data: { id: 'm-x', channel_id: 'other', author_id: ME.id, body: 'Hi' }, error: null }))
    expect(await sendMessage({ me: ME, channel: { id: 'ch-1', kind: 'site' }, draft: 'Hi' }, wrong.client)).toMatchObject({ ok: false })
    const blank = recorder(() => ({ data: null, error: null }))
    expect(await sendMessage({ me: ME, channel: { id: 'ch-1', kind: 'site' }, draft: '   ' }, blank.client)).toMatchObject({ ok: false })
    expect(blank.calls).toHaveLength(0)
  })

  it('a direct message takes no photo, as on the phone', async () => {
    const { calls, client } = recorder(() => ({ data: null, error: null }))
    expect(await sendMessage({ me: ME, channel: { id: 'ch-dm', kind: 'dm' }, draft: '', attachmentPath: 'x/y/z.jpg' }, client)).toMatchObject({ ok: false })
    expect(calls).toHaveLength(0)
    // The phone's DM thread draws no attachment at all.
    expect(dmThread.getText(CHAT)).not.toContain('attachment_path')
  })
})

describe('photos (ChatScreen attach)', () => {
  const attach = decl(chatScreen, 'attach') as ts.FunctionDeclaration

  it("the same ceiling, the same idea of a photo, the same camera key", () => {
    expect(CHAT_ATTACHMENT_MAX).toBe(run<number>('', {}, (decl(APP, 'CHAT_ATTACHMENT_MAX') as ts.VariableDeclaration).initializer!.getText(APP)))
    expect(CHAT_IMAGE_RE.source).toBe(run<RegExp>('', {}, (decl(APP, 'CHAT_IMAGE_RE') as ts.VariableDeclaration).initializer!.getText(APP)).source)
    const input = all(chatScreen, (n): n is ts.JsxSelfClosingElement => ts.isJsxSelfClosingElement(n) && n.tagName.getText(APP) === 'input' && n.getText(APP).includes('type="file"'))
    expect(input).toHaveLength(1)
    const accept = input[0]!.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(APP) === 'accept') as ts.JsxAttribute
    expect((accept.initializer as ts.StringLiteral).text).toBe(CHAT_ACCEPT)
    // The name the phone shows under a file.
    expect(decl(APP, 'ChatAttachment').getText(APP)).toContain("name.replace(/^[0-9a-f-]{36}-/i, '')")
    expect(attachmentName('co-1/ch-1/0f8fad5b-d9cb-469f-a165-70867728950e-Bathroom_plan.pdf')).toBe('Bathroom_plan.pdf')
  })

  it("goes where the phone puts it, <company>/<channel>/, in site-files, then sends with what was typed", async () => {
    const text = attach.getText(APP)
    expect(text).toContain('objectPath(me.company_id, channel.id, file.name)')
    expect(text).toContain('uploadFile(BUCKET_FILES, path, file)')
    expect(text).toContain('await send(path)')

    vi.mocked(objectPath).mockClear()
    vi.mocked(uploadFile).mockClear()
    const { calls, client } = recorder((_t, log) => ({ data: { id: 'm-p', ...(log.find((c) => c.method === 'insert')!.args[0] as object) }, error: null }))
    const file = new File([new Uint8Array(10)], 'site photo.jpg', { type: 'image/jpeg' })
    const out = await sendAttachment({ me: ME, channel: { id: 'ch-1', kind: 'site' }, draft: 'Grout colour?', file }, client)
    expect(out.ok).toBe(true)
    expect(vi.mocked(objectPath).mock.calls[0]).toEqual([ME.company_id, 'ch-1', 'site photo.jpg'])
    const path = vi.mocked(uploadFile).mock.calls[0]![1]
    expect(vi.mocked(uploadFile).mock.calls[0]![0]).toBe(BUCKET_FILES)
    expect(path).toMatch(/^co-1\/ch-1\/[0-9a-f-]{36}-site_photo\.jpg$/)
    expect(calls[0]!.args[0]).toEqual(jobMessageInsert({ me: ME, channelId: 'ch-1', body: 'Grout colour?', attachmentPath: path }))
  })

  it('a message that does not save takes its file back out; too big sends nothing', async () => {
    vi.mocked(removeFile).mockClear()
    vi.mocked(uploadFile).mockClear()
    const { client } = recorder(() => ({ data: null, error: { message: 'permission denied' } }))
    const out = await sendAttachment({ me: ME, channel: { id: 'ch-1', kind: 'site' }, draft: '', file: new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }) }, client)
    expect(out.ok).toBe(false)
    expect(vi.mocked(removeFile).mock.calls[0]?.[1]).toBe(vi.mocked(uploadFile).mock.calls[0]?.[1])

    vi.mocked(uploadFile).mockClear()
    const big = { name: 'huge.jpg', size: CHAT_ATTACHMENT_MAX + 1, type: 'image/jpeg' } as File
    expect(await sendAttachment({ me: ME, channel: { id: 'ch-1', kind: 'site' }, draft: '', file: big }, client)).toEqual({ ok: false, message: 'huge.jpg is over 25 MB. Send a smaller copy.' })
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it('takes photos and PDFs, which a phone can open, and nothing else', () => {
    expect(attachmentRefusal({ name: 'a.heic', size: 5, type: '' })).toBeNull()
    expect(attachmentRefusal({ name: 'plan.pdf', size: 5, type: 'application/pdf' })).toBeNull()
    expect(attachmentRefusal({ name: 'quote.xlsx', size: 5, type: 'application/vnd.ms-excel' })).toMatch(/not a photo or a PDF/)
    expect(attachmentRefusal({ name: 'empty.jpg', size: 0, type: 'image/jpeg' })).toMatch(/empty/)
  })
})

// ------------------------------------------------------------------ direct messages

describe('starting a direct message (ComposeSheet)', () => {
  const pick = decl(composeSheet, 'pick') as ts.FunctionDeclaration
  const channelsInsert = callsOf(pick, 'insert').find((c) => c.arguments[0] && ts.isObjectLiteralExpression(c.arguments[0]))!
  const membersInsert = callsOf(pick, 'insert').find((c) => c.arguments[0] && ts.isArrayLiteralExpression(c.arguments[0]))!

  it("makes the phone's channel row", () => {
    expect(chainFrom(pick, 'channels').map((s) => s.method)).toEqual(['from', 'insert', 'select', 'single'])
    const p = run<Record<string, unknown>>('', { me: ME, personId: DEAN, dmName: phone.dmName }, channelsInsert.arguments[0]!.getText(CHAT))
    const w = dmChannelInsert(ME, DEAN)
    expect(Object.keys(w)).toEqual(Object.keys(p))
    expect(w).toEqual(p)
  })

  it("and puts the same two people in it", () => {
    expect(chainFrom(pick, 'channel_members').map((s) => s.method)).toEqual(['from', 'insert'])
    const p = run<unknown[]>('', { me: ME, personId: DEAN, channelId: 'ch-new' }, membersInsert.arguments[0]!.getText(CHAT))
    expect(dmMemberRows('ch-new', ME, DEAN)).toEqual(p)
  })

  it('opens the one already listed without writing', async () => {
    const { calls, client } = recorder(() => ({ data: null, error: null }))
    const known = ch('ch-known', 'dm', dmName(ME.id, DEAN))
    expect(await startDm({ me: ME, personId: DEAN, known }, client)).toEqual({ ok: true, channel: known, created: false })
    expect(calls).toHaveLength(0)
  })

  it('finds one by its name before making another', async () => {
    const existing = ch('ch-old', 'dm', dmName(ME.id, DEAN))
    const { calls, client } = recorder(() => ({ data: [existing], error: null }))
    expect(await startDm({ me: ME, personId: DEAN }, client)).toEqual({ ok: true, channel: existing, created: false })
    expect(calls.some((c) => c.method === 'insert')).toBe(false)
    expect(calls).toContainEqual({ table: 'channels', method: 'eq', args: ['name', dmName(ME.id, DEAN)] })
  })

  it('makes a new one exactly as the phone does, and reads both people back', async () => {
    const { calls, client } = recorder((table, log) => {
      const last = log[log.length - 1]!
      if (table === 'channels' && last.method === 'single') return { data: { id: 'ch-new', ...(log.find((c) => c.method === 'insert')!.args[0] as object) }, error: null }
      if (table === 'channel_members') return { data: log.filter((c) => c.table === 'channel_members' && c.method === 'insert').flatMap((c) => c.args[0] as unknown[]), error: null }
      return { data: [], error: null }
    })
    const out = await startDm({ me: ME, personId: DEAN }, client)
    expect(out).toMatchObject({ ok: true, created: true, channel: { id: 'ch-new', kind: 'dm', name: dmName(ME.id, DEAN) } })
    const inserts = calls.filter((c) => c.method === 'insert')
    expect(inserts.map((c) => [c.table, c.args[0]])).toEqual([
      ['channels', dmChannelInsert(ME, DEAN)],
      ['channel_members', dmMemberRows('ch-new', ME, DEAN)],
    ])
  })

  it('says so when the two people could not be added', async () => {
    const { client } = recorder((table, log) => {
      if (table === 'channels' && log[log.length - 1]!.method === 'single') return { data: { id: 'ch-new', ...(log.find((c) => c.method === 'insert')!.args[0] as object) }, error: null }
      if (table === 'channel_members') return { data: [], error: null }
      return { data: [], error: null }
    })
    expect(await startDm({ me: ME, personId: DEAN }, client)).toEqual({ ok: false, message: expect.stringMatching(/could not be added/) })
  })
})

// ------------------------------------------------------------------ a thread as drawn

describe('a thread as drawn', () => {
  it('a day separator wherever the local date changes, labelled as the phone labels it', () => {
    const msgs = [
      msg('c', DEAN, '2026-10-19T23:00:00.000Z', 'a'),
      msg('c', DEAN, '2026-10-19T23:05:00.000Z', 'b'),
      msg('c', ME.id, '2026-10-20T03:00:00.000Z', 'c'),
      { ...msg('c', null, '2026-10-21T01:00:00.000Z', 'Dean clocked on'), kind: 'system' as const },
      msg('c', DEAN, '2026-10-21T01:01:00.000Z', 'd'),
      msg('c', MARIA, '2026-10-21T01:02:00.000Z', 'e'),
      msg('c', MARIA, '2026-10-21T01:03:00.000Z', 'f'),
    ]
    const items = threadItems(msgs, ME.id)
    const days = items.filter((i) => i.type === 'day').map((i) => (i as { label: string }).label)
    const phoneDays = [...new Set(msgs.map((m) => new Date(m.created_at).toDateString()))].map((k) => phone.chatDayLabel(new Date(k)))
    expect(days).toEqual(phoneDays)
    const shape = items.map((i) => (i.type === 'message' ? `${i.mine ? 'me' : i.message.author_id}${i.runStart ? '*' : ''}` : i.type))
    // Each person's first message after a day line, a system line or someone else carries their name (*).
    expect(shape.filter((x) => x !== 'day')).toEqual([`${DEAN}*`, DEAN, 'me*', 'system', `${DEAN}*`, `${MARIA}*`, MARIA])
    expect(items.find((i) => i.type === 'system')).toMatchObject({ time: clockLabel('2026-10-21T01:00:00.000Z') })
  })

  it('a page put together with live messages: oldest first, each once', () => {
    const a = msg('c', DEAN, '2026-10-21T01:00:00Z')
    const b = msg('c', ME.id, '2026-10-21T01:00:01Z')
    const c = msg('c', DEAN, '2026-10-21T02:00:00Z')
    expect(mergeThread([b, a], [c, b]).map((m) => m.id)).toEqual([a.id, b.id, c.id])
    expect(mergeThread([], [])).toEqual([])
  })
})

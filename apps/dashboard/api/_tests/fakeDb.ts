/**
 * An in-memory stand-in for the slice of supabase-js the functions use, so a
 * handler can be run end to end in a test: from(table) with select / insert /
 * update / upsert / delete, the filters and modifiers they chain, rpc(), and
 * auth.admin.
 *
 * It behaves like PostgREST where the functions depend on it:
 *  - timestamps come back the way Postgres writes them ("…+00:00", trailing
 *    zeros dropped), and compare as instants, not strings;
 *  - shifts refuse a second open shift (23505, shifts_one_open_per_worker) and
 *    overlapping ones (23P01, shifts_no_overlap), and an end before a start;
 *  - dwell_state.worker_id is a primary key;
 *  - ilike reads `%`, `*` and `_` as wildcards and `\` as the escape.
 *
 * `before` runs ahead of every statement and may await, which is how a test
 * makes two requests interleave at an exact point.
 *
 * Lives in an underscore directory, so Vercel never deploys it as a function.
 */

export type Row = Record<string, unknown>

export interface PgError {
  code: string
  message: string
}

type FilterOp = 'eq' | 'neq' | 'is' | 'ilike' | 'gte' | 'gt' | 'lte' | 'lt'

interface Filter {
  col: string
  op: FilterOp
  value: unknown
}

export interface Statement {
  table: string
  kind: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  filters: Filter[]
  payload?: unknown
  columns?: string
}

type Result = { data: unknown; error: PgError | null }

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

const isTimestampCol = (col: string) => col === 'at' || col.endsWith('_at')

/** A timestamp the way Postgres hands one back. */
export function pgTimestamp(v: string): string {
  const iso = new Date(v).toISOString() // 2026-10-20T22:30:00.120Z
  const [whole, frac] = iso.slice(0, -1).split('.')
  const trimmed = (frac ?? '').replace(/0+$/, '')
  return `${whole}${trimmed ? `.${trimmed}` : ''}+00:00`
}

function comparable(v: unknown): unknown {
  return typeof v === 'string' && ISO.test(v) ? Date.parse(v) : v
}

function likeToRegExp(pattern: string): RegExp {
  let src = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!
    if (c === '\\' && i + 1 < pattern.length) {
      src += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (c === '%' || c === '*') src += '.*'
    else if (c === '_') src += '.'
    else src += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${src}$`, 'is')
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col]
  switch (f.op) {
    case 'eq':
      return comparable(v) === comparable(f.value)
    case 'neq':
      return comparable(v) !== comparable(f.value)
    case 'is':
      return f.value === null ? v === null || v === undefined : v === f.value
    case 'ilike':
      return typeof v === 'string' && likeToRegExp(String(f.value)).test(v)
    case 'gte':
      return (comparable(v) as number) >= (comparable(f.value) as number)
    case 'gt':
      return (comparable(v) as number) > (comparable(f.value) as number)
    case 'lte':
      return (comparable(v) as number) <= (comparable(f.value) as number)
    case 'lt':
      return (comparable(v) as number) < (comparable(f.value) as number)
  }
}

function project(row: Row, columns: string | undefined): Row {
  const out: Row = {}
  const source = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && isTimestampCol(k) && ISO.test(v) ? pgTimestamp(v) : v]),
  )
  if (!columns || columns.trim() === '*') return source
  for (const raw of columns.split(',')) {
    const col = raw.trim()
    // An embedded relation, e.g. workers!shifts_worker_id_fkey(name): handed
    // back as stored under the relation's name, if the test stored one.
    const rel = /^([a-z_]+)(?:!|\()/.exec(col)
    if (rel) {
      if (rel[1]! in row) out[rel[1]!] = row[rel[1]!]
      continue
    }
    out[col] = source[col]
  }
  return out
}

const range = (r: Row): [number, number] => [
  Date.parse(String(r.started_at)),
  r.ended_at == null ? Infinity : Date.parse(String(r.ended_at)),
]

export class FakeDb {
  tables: Record<string, Row[]> = {}
  /** Every statement run, in order. */
  log: Statement[] = []
  /** Runs before each statement; may await to let another request through first. */
  before?: (s: Statement) => void | Promise<void>
  /** Make one table's reads (or writes) fail, as a broken connection would. */
  failing: Partial<Record<string, PgError>> = {}
  rpcs: Record<string, (args: Record<string, unknown>) => Result> = {}
  deletedUsers: string[] = []
  generatedLinks: unknown[] = []
  private nextId = 1

  auth = {
    admin: {
      deleteUser: async (id: string) => {
        this.deletedUsers.push(id)
        return { data: {}, error: null }
      },
      generateLink: async (args: unknown) => {
        this.generatedLinks.push(args)
        return { data: { properties: { hashed_token: 'hash' } }, error: null }
      },
    },
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }

  seed(table: string, ...rows: Row[]): void {
    this.rows(table).push(...rows.map((r) => ({ ...r })))
  }

  from(table: string): Query {
    return new Query(this, table)
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<Result> {
    this.log.push({ table: `rpc:${name}`, kind: 'select', filters: [], payload: args })
    const fn = this.rpcs[name]
    if (!fn) return { data: null, error: { code: 'PGRST202', message: `no function ${name}` } }
    return fn(args)
  }

  /** Inserts one row into `table`, enforcing the constraints the functions rely on. */
  insertRow(table: string, row: Row): PgError | null {
    const rows = this.rows(table)
    if (table === 'dwell_state' && rows.some((r) => r.worker_id === row.worker_id)) {
      return { code: '23505', message: 'duplicate key value violates unique constraint "dwell_state_pkey"' }
    }
    if (table === 'shifts') {
      const refused = this.shiftConflict(row, rows)
      if (refused) return refused
    }
    const stored = { ...row }
    if (!('id' in stored)) stored.id = table === 'positions' || table === 'geofence_events' ? this.nextId++ : `${table}-${this.nextId++}`
    rows.push(stored)
    return null
  }

  shiftConflict(row: Row, rows: Row[], except?: Row): PgError | null {
    const [start, end] = range(row)
    if (end < start) return { code: '22000', message: 'range lower bound must be less than or equal to range upper bound' }
    const others = rows.filter((r) => r !== except && r.worker_id === row.worker_id)
    if (row.ended_at == null && others.some((r) => r.ended_at == null)) {
      return { code: '23505', message: 'duplicate key value violates unique constraint "shifts_one_open_per_worker"' }
    }
    if (others.some((r) => { const [s, e] = range(r); return start < e && s < end })) {
      return { code: '23P01', message: 'conflicting key value violates exclusion constraint "shifts_no_overlap"' }
    }
    return null
  }
}

export class Query implements PromiseLike<Result> {
  private kind: Statement['kind'] = 'select'
  private filters: Filter[] = []
  private payload: unknown
  private columns: string | undefined
  private returning = false
  private orderBy: { col: string; asc: boolean } | null = null
  private limitTo: number | null = null
  private one: 'maybe' | 'single' | null = null
  private upsertConflict: string | undefined
  private db: FakeDb
  private table: string

  constructor(db: FakeDb, table: string) {
    this.db = db
    this.table = table
  }

  select(columns = '*'): this {
    if (this.kind === 'select') this.columns = columns
    else {
      this.returning = true
      this.columns = columns
    }
    return this
  }
  insert(payload: Row | Row[]): this {
    this.kind = 'insert'
    this.payload = payload
    return this
  }
  update(payload: Row): this {
    this.kind = 'update'
    this.payload = payload
    return this
  }
  upsert(payload: Row, opts?: { onConflict?: string }): this {
    this.kind = 'upsert'
    this.payload = payload
    this.upsertConflict = opts?.onConflict
    return this
  }
  delete(): this {
    this.kind = 'delete'
    return this
  }
  private filter(col: string, op: FilterOp, value: unknown): this {
    this.filters.push({ col, op, value })
    return this
  }
  eq(col: string, value: unknown) { return this.filter(col, 'eq', value) }
  neq(col: string, value: unknown) { return this.filter(col, 'neq', value) }
  is(col: string, value: unknown) { return this.filter(col, 'is', value) }
  ilike(col: string, value: string) { return this.filter(col, 'ilike', value) }
  gte(col: string, value: unknown) { return this.filter(col, 'gte', value) }
  gt(col: string, value: unknown) { return this.filter(col, 'gt', value) }
  lte(col: string, value: unknown) { return this.filter(col, 'lte', value) }
  lt(col: string, value: unknown) { return this.filter(col, 'lt', value) }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { col, asc: opts?.ascending !== false }
    return this
  }
  limit(n: number): this {
    this.limitTo = n
    return this
  }
  maybeSingle(): this {
    this.one = 'maybe'
    return this
  }
  single(): this {
    this.one = 'single'
    return this
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected)
  }

  private async run(): Promise<Result> {
    const statement: Statement = {
      table: this.table,
      kind: this.kind,
      filters: this.filters,
      payload: this.payload,
      columns: this.columns,
    }
    await this.db.before?.(statement)
    this.db.log.push(statement)
    const failure = this.db.failing[this.table]
    if (failure) return { data: null, error: failure }

    const rows = this.db.rows(this.table)
    const hits = () => rows.filter((r) => this.filters.every((f) => matches(r, f)))
    let out: Row[] = []

    if (this.kind === 'select') {
      out = hits()
    } else if (this.kind === 'insert') {
      for (const row of [this.payload].flat() as Row[]) {
        const error = this.db.insertRow(this.table, row)
        if (error) return { data: null, error }
        out.push(rows[rows.length - 1]!)
      }
    } else if (this.kind === 'update') {
      const patch = this.payload as Row
      out = hits()
      for (const row of out) {
        if (this.table === 'shifts') {
          const error = this.db.shiftConflict({ ...row, ...patch }, rows, row)
          if (error) return { data: null, error }
        }
      }
      for (const row of out) Object.assign(row, patch)
    } else if (this.kind === 'upsert') {
      const row = this.payload as Row
      const keys = (this.upsertConflict ?? (this.table === 'dwell_state' ? 'worker_id' : 'id')).split(',').map((k) => k.trim())
      const existing = rows.find((r) => keys.every((k) => r[k] === row[k]))
      if (existing) Object.assign(existing, row)
      else {
        const error = this.db.insertRow(this.table, row)
        if (error) return { data: null, error }
      }
      out = [existing ?? rows[rows.length - 1]!]
    } else {
      out = hits()
      for (const row of out) rows.splice(rows.indexOf(row), 1)
    }

    if (this.kind !== 'select' && !this.returning) return { data: null, error: null }

    if (this.orderBy) {
      const { col, asc } = this.orderBy
      out = [...out].sort((a, b) => {
        const x = comparable(a[col]) as number
        const y = comparable(b[col]) as number
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1)
      })
    }
    if (this.limitTo !== null) out = out.slice(0, this.limitTo)
    const data = out.map((r) => project(r, this.columns))

    if (this.one === 'maybe') {
      if (data.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } }
      return { data: data[0] ?? null, error: null }
    }
    if (this.one === 'single') {
      if (data.length !== 1) return { data: null, error: { code: 'PGRST116', message: `${data.length} rows returned` } }
      return { data: data[0], error: null }
    }
    return { data, error: null }
  }
}

/** The bits of a Vercel response the handlers touch, recording what they did. */
export class FakeResponse {
  statusCode = 200
  headers: Record<string, string> = {}
  body: unknown = undefined
  ended = false
  status(code: number) {
    this.statusCode = code
    return this
  }
  json(body: unknown) {
    this.body = body
    this.ended = true
    return this
  }
  setHeader(key: string, value: string) {
    this.headers[key.toLowerCase()] = value
    return this
  }
  end() {
    this.ended = true
    return this
  }
}

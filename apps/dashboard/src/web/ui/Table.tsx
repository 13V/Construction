/**
 * A real <table> in the Simple design: white, hairline rows, a tracked-caps
 * header. Rows are 52 px by default (the board) or 44 px (dense lists).
 *
 * A row with somewhere to go (`rowHref`) is a link in all but tag: the
 * pointer opens it, Cmd/Ctrl-click opens it in a new tab, it is in the Tab
 * order and Enter opens it. A click on a button, link or input inside the
 * row is left to that control.
 *
 *   <Table label="Jobs" rows={jobs} rowKey={(j) => j.id} rowHref={(j) => paths.job(j.id)}
 *     columns={[{ key: 'job', header: 'Job', render: (j) => j.name }, …]} />
 */
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { navigate } from '../router'
import { color, radius, size, space, text } from '../tokens'

export interface Column<R> {
  key: string
  header: ReactNode
  render: (row: R) => ReactNode
  /** A fixed width (px or any CSS length); columns without one share the rest. */
  width?: number | string
  align?: 'left' | 'right' | 'center'
  /** Cell padding off, for an edge strip such as the job's colour rail. */
  flush?: boolean
}

export interface TableProps<R> {
  columns: ReadonlyArray<Column<R>>
  rows: ReadonlyArray<R>
  rowKey: (row: R) => string
  /** What the table lists, for a screen reader. */
  label: string
  rowHref?: (row: R) => string | null
  onRowClick?: (row: R) => void
  rowHeight?: number
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode
  /** Header stays in view while the page scrolls. */
  stickyHeader?: boolean
  rowStyle?: (row: R) => CSSProperties | undefined
  /** A row's accessible name, e.g. the job's title, read when it takes focus. */
  rowLabel?: (row: R) => string
}

/** True when the event started on a control inside the row, which should handle it itself. */
const fromControl = (e: { target: EventTarget; currentTarget: EventTarget }) => {
  const el = e.target as Element
  const control = el.closest('a, button, input, select, textarea, label, [role="menu"], [role="menuitem"]')
  return control !== null && control !== e.currentTarget
}

export function Table<R>({
  columns,
  rows,
  rowKey,
  label,
  rowHref,
  onRowClick,
  rowHeight = size.rowTall,
  empty,
  stickyHeader = false,
  rowStyle,
  rowLabel,
}: TableProps<R>) {
  const open = (row: R, e: MouseEvent | KeyboardEvent) => {
    const href = rowHref?.(row)
    if (href) {
      if ('metaKey' in e && (e.metaKey || e.ctrlKey)) window.open(href, '_blank', 'noopener')
      else navigate(href)
      return
    }
    onRowClick?.(row)
  }
  const clickable = Boolean(rowHref || onRowClick)

  const cellPad = (c: Column<R>) => (c.flush ? 0 : `0 ${space.sm}px`)

  return (
    <div style={{ background: color.panel, border: `1px solid ${color.borderSoft}`, borderRadius: radius.lg, overflow: stickyHeader ? 'visible' : 'hidden' }}>
      <table aria-label={label} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width !== undefined ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{
                  height: 36,
                  padding: cellPad(c),
                  textAlign: c.align ?? 'left',
                  ...text.label,
                  fontSize: 11,
                  color: color.muted,
                  background: color.rowFill,
                  borderBottom: `1px solid ${color.borderSoft}`,
                  whiteSpace: 'nowrap',
                  ...(stickyHeader ? { position: 'sticky', top: 0, zIndex: 1 } : null),
                }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty !== undefined ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: space.lg, ...text.base, color: color.muted, textAlign: 'center' }}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row)}
                className={clickable ? 'wb-row wb-row--link' : 'wb-row'}
                tabIndex={clickable ? 0 : undefined}
                aria-label={rowLabel?.(row)}
                onClick={
                  clickable
                    ? (e) => {
                        if (!fromControl(e)) open(row, e)
                      }
                    : undefined
                }
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === 'Enter' && e.target === e.currentTarget) {
                          e.preventDefault()
                          open(row, e)
                        }
                      }
                    : undefined
                }
                style={{ height: rowHeight, borderTop: i === 0 ? undefined : `1px solid ${color.borderSoft}`, ...rowStyle?.(row) }}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: cellPad(c), textAlign: c.align ?? 'left', verticalAlign: 'middle', ...text.base, color: color.ink, overflow: 'hidden' }}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

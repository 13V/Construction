import type { CSSProperties, ReactNode } from 'react'
import { theme } from '../theme'

/**
 * The handful of shapes every screen in this app is built from.
 *
 * These were being redeclared at the bottom of each screen file — the same
 * panel border, the same 10.5px uppercase label, the same yellow CTA with the
 * 1px #E0A032 border. Five copies of a token is five chances for one of them to
 * drift, and the theme file already carries a note about exactly that happening
 * to the CTA gradient. Everything here is measured off design/screens/*.html,
 * the same source theme.ts is measured from.
 */

export const LABEL = theme.inkFaint
const ROW_BORDER = theme.borderSoft
const DASH_BORDER = '#C3C9D0'

// --------------------------------------------------------------- containers

export const panelStyle: CSSProperties = {
  background: theme.panel,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  overflow: 'hidden',
}

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...panelStyle, ...style }}>{children}</div>
}

export function PanelHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 15px',
        borderBottom: `1px solid ${theme.border}`,
        fontSize: 15,
        fontWeight: 600,
      }}
    >
      <span style={{ minWidth: 0 }}>{children}</span>
      {right && (
        <>
          <span style={{ flex: 1 }} />
          {right}
        </>
      )}
    </div>
  )
}

/** A dashed empty state. Always says what to do next, never just "nothing here". */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '30px 24px',
        border: `1.5px dashed ${DASH_BORDER}`,
        borderRadius: 8,
        background: theme.rowFill,
        fontSize: 12.5,
        lineHeight: 1.55,
        color: theme.inkSoft,
        textAlign: 'center',
        textWrap: 'pretty',
      }}
    >
      <span style={{ maxWidth: 520 }}>{children}</span>
    </div>
  )
}

// -------------------------------------------------------------------- bits

export function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 9px',
        borderRadius: 11,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        background: bg,
        color: fg,
      }}
    >
      {label}
    </span>
  )
}

/** One labelled figure. The grid gap shows through as a 1px rule between them. */
export function Fact({
  k,
  v,
  note,
  fg = theme.ink,
}: {
  k: string
  v: string
  note?: string | null
  fg?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '12px 14px', background: theme.panel }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', color: LABEL, whiteSpace: 'nowrap' }}>
        {k}
      </span>
      <span style={{ fontSize: 17, fontWeight: 600, color: fg, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
      {note && <span style={{ fontSize: 11.5, color: LABEL }}>{note}</span>}
    </div>
  )
}

export function FactGrid({ children, min = 150 }: { children: ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`,
        gap: 1,
        background: theme.border,
      }}
    >
      {children}
    </div>
  )
}

export function Field({
  label,
  width,
  children,
}: {
  label: string
  width?: number | string
  children: ReactNode
}) {
  return (
    <label style={{ ...labelStyle, width: width ?? '100%' }}>
      {label}
      {children}
    </label>
  )
}

/** A row in a list. Columns are given by the caller so each list can differ. */
export function ListRow({
  columns,
  children,
  onClick,
  active = false,
}: {
  columns: string
  children: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        columnGap: 10,
        gridTemplateColumns: columns,
        alignItems: 'center',
        padding: '9px 15px',
        borderBottom: `1px solid ${ROW_BORDER}`,
        background: active ? theme.accentFill : 'transparent',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {children}
    </div>
  )
}

export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'alert' }) {
  const bg = tone === 'warn' ? theme.warnFill : tone === 'alert' ? theme.alertFill : 'transparent'
  const fg = tone === 'warn' ? theme.warnInk : tone === 'alert' ? theme.alertInk : theme.inkSoft
  return (
    <div
      style={{
        padding: '10px 15px',
        borderTop: `1px solid ${theme.border}`,
        background: bg,
        fontSize: 12.5,
        lineHeight: 1.5,
        color: fg,
      }}
    >
      {children}
    </div>
  )
}

// ------------------------------------------------------------------ tokens

export const TAB_PAD = '16px 18px 40px'

export const labelStyle: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: theme.inkFaint,
  display: 'block',
  marginTop: 8,
}

export const fieldStyle: CSSProperties = {
  display: 'block',
  height: 32,
  padding: '0 9px',
  marginTop: 4,
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  fontFamily: 'inherit',
  fontSize: 13,
  color: theme.ink,
  width: '100%',
}

/**
 * The one primary button treatment: 180deg, that stop order, and the border.
 * theme.ts records that every hand-rolled copy of this in the codebase had at
 * least one of the three wrong.
 */
export const ctaStyle: CSSProperties = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.ctaBorder}`,
  background: theme.cta,
  color: theme.ink,
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '.04em',
  cursor: 'pointer',
}

export const ghostStyle: CSSProperties = {
  padding: '7px 13px',
  borderRadius: 3,
  border: `1px solid ${theme.border}`,
  background: theme.panel,
  color: theme.ink,
  fontFamily: 'inherit',
  fontSize: 11.5,
  cursor: 'pointer',
}

export const linkStyle: CSSProperties = {
  border: 0,
  background: 'transparent',
  padding: 0,
  font: 'inherit',
  fontSize: 12,
  color: theme.accent,
  cursor: 'pointer',
}

/** Sub-tabs inside a tab, for a screen that carries several related lists. */
export function SubTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: T; label: string; count?: number; tone?: 'alert' | 'warn' }>
  active: T
  onChange: (t: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      {tabs.map((t) => {
        const on = t.key === active
        const tone = t.tone === 'alert' ? theme.alert : t.tone === 'warn' ? theme.warnInk : theme.inkSoft
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 15,
              border: `1px solid ${on ? theme.ink : theme.border}`,
              background: on ? theme.ink : theme.panel,
              color: on ? '#fff' : theme.ink,
              fontFamily: 'inherit',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700,
                  fontSize: 11,
                  color: on ? '#fff' : tone,
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

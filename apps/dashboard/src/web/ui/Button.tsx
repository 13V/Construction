/**
 * The website's button: always a real <button>, or a real <a> when it goes
 * somewhere, so it is reachable by Tab, works with Enter and Space, and shows
 * the focus ring (web.css). The phone draws most of its controls as <span
 * onClick>, which a keyboard cannot reach; nothing on a desk may.
 *
 *   <Button variant="primary" onClick={save}>Save</Button>
 *   <Button href="/jobs/new" icon={<Plus />}>New job</Button>
 *
 * Colours live in web.css (hover and pressed cannot be inline); size and
 * layout are inline.
 */
import type { ComponentPropsWithRef, CSSProperties, MouseEvent, ReactNode } from 'react'
import { linkProps } from '../router'
import { radius, size } from '../tokens'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface Common {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Drawn before the label. */
  icon?: ReactNode
  /** Disables the button and shows a spinner beside the label, which stays put. */
  loading?: boolean
  /** Full width of its container. */
  block?: boolean
}

export type ButtonProps = Common & ComponentPropsWithRef<'button'> & { href?: undefined }
export type LinkButtonProps = Common & ComponentPropsWithRef<'a'> & { href: string }

const SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { height: size.controlSm, padding: '0 12px', fontSize: 13, borderRadius: radius.sm },
  md: { height: size.control, padding: '0 16px', fontSize: 14, borderRadius: radius.md },
  lg: { height: size.controlLg, padding: '0 20px', fontSize: 15, borderRadius: radius.md },
}

export function Spinner({ size: px = 14 }: { size?: number }) {
  return (
    <svg className="wb-spin" width={px} height={px} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function Button(props: ButtonProps | LinkButtonProps) {
  const { variant = 'secondary', size: sz = 'md', icon, loading = false, block = false, className, style, children, ...rest } = props
  const cls = `wb-btn wb-btn--${variant}${className ? ` ${className}` : ''}`
  const look: CSSProperties = { ...SIZES[sz], ...(block ? { display: 'flex', width: '100%' } : null), ...style }
  const inner = (
    <>
      {loading ? <Spinner /> : icon ? <span aria-hidden="true" style={{ display: 'inline-flex', flex: 'none' }}>{icon}</span> : null}
      {children}
    </>
  )

  if (rest.href !== undefined) {
    const { href, onClick, ...anchor } = rest as LinkButtonProps
    const nav = linkProps(href)
    return (
      <a
        {...anchor}
        href={href}
        className={cls}
        style={look}
        aria-disabled={loading || undefined}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          if (loading) {
            e.preventDefault()
            return
          }
          onClick?.(e)
          nav.onClick(e)
        }}
      >
        {inner}
      </a>
    )
  }

  const { type = 'button', disabled, ...button } = rest as ButtonProps
  return (
    <button {...button} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cls} style={look}>
      {inner}
    </button>
  )
}

/** A square icon-only button. `label` is what a screen reader and the tooltip say. */
export function IconButton({
  label,
  children,
  size: px = 32,
  className,
  style,
  ...rest
}: { label: string; size?: number } & Omit<ComponentPropsWithRef<'button'>, 'aria-label'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`wb-icon-btn${className ? ` ${className}` : ''}`}
      style={{ width: px, height: px, flex: 'none', ...style }}
    >
      {children}
    </button>
  )
}

/** The close cross used by drawers, dialogs, banners and toasts. */
export function CloseIcon({ size: px = 14 }: { size?: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** The plus on New job and Add buttons. */
export function PlusIcon({ size: px = 14 }: { size?: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 2.5v9M2.5 7h9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
